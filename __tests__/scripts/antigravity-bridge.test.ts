// @vitest-environment node
/**
 * Antigravity in a sandbox, without the sandbox holding its credential.
 *
 * `agy` keeps its Google login in the desktop keyring, which a container has
 * not got. The two obvious fixes are both wrong — copying the token in puts a
 * broad-scope Google refresh token next to agent-written code, and baking the
 * CLI into the image redistributes a vendor binary and still needs the token.
 * So the adapter runs on the host and the sandbox reaches it.
 *
 * The cases here are the ones where it must refuse, and the one rewrite that
 * makes it work at all. A bridge that answered the wrong container would hand
 * a conversation somebody else's files.
 *
 * Node project: it opens real sockets and spawns real processes.
 */
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import {
  BridgeRefused,
  SANDBOX_WORKSPACE,
  rewriteWorkspace,
  startAntigravityBridge,
  tokenMatches,
  workspaceForPeer,
} from "../../scripts/antigravity-bridge.mjs";

/** Docker, as the bridge asks it: a list, then one inspect per container. */
function fakeDocker(
  containers: Record<string, { ip: string; workspace: string }>,
) {
  return async (args: string[]) => {
    if (args[0] === "ps") return `${Object.keys(containers).join("\n")}\n`;
    const entry = containers[args[1]];
    return `${entry.ip}|${entry.workspace}\n`;
  };
}

describe("which host directory a sandbox gets", () => {
  it("reads it from docker rather than being told", async () => {
    // Configured, it would go stale and hand a conversation another
    // conversation's files. Derived, a wrong answer is impossible.
    const workspace = await workspaceForPeer(
      "172.17.0.6",
      fakeDocker({
        a1: { ip: "172.17.0.5", workspace: "/host/other" },
        b2: { ip: "172.17.0.6", workspace: "/host/mine" },
      }),
    );

    expect(workspace).toBe("/host/mine");
  });

  it("reads an IPv4 address that arrived mapped into IPv6", async () => {
    expect(
      await workspaceForPeer(
        "::ffff:172.17.0.6",
        fakeDocker({ b2: { ip: "172.17.0.6", workspace: "/host/mine" } }),
      ),
    ).toBe("/host/mine");
  });

  it("refuses a peer that is not a container on this host", async () => {
    // The port is on the docker bridge, which something other than a sandbox
    // could reach. Serving it would be serving an unknown caller.
    await expect(
      workspaceForPeer(
        "10.0.0.9",
        fakeDocker({ b2: { ip: "172.17.0.6", workspace: "/w" } }),
      ),
    ).rejects.toThrow(BridgeRefused);
  });

  it("refuses a container with no workspace of its own", async () => {
    // There is no directory on this side to give it, and picking one would
    // be inventing an answer.
    await expect(
      workspaceForPeer(
        "172.17.0.6",
        fakeDocker({ b2: { ip: "172.17.0.6", workspace: "" } }),
      ),
    ).rejects.toThrow(/no \/workspace mount/);
  });
});

describe("the one thing rewritten", () => {
  it("swaps the sandbox's workspace for the host's", () => {
    const line = rewriteWorkspace(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "session/new",
        params: { cwd: SANDBOX_WORKSPACE, mcpServers: [] },
      }),
      "/host/mine",
    );

    expect(JSON.parse(line).params.cwd).toBe("/host/mine");
  });

  it("keeps a path below the workspace below it", () => {
    const line = rewriteWorkspace(
      JSON.stringify({
        method: "session/new",
        params: { cwd: `${SANDBOX_WORKSPACE}/repo` },
      }),
      "/host/mine",
    );

    expect(JSON.parse(line).params.cwd).toBe("/host/mine/repo");
  });

  it("leaves a path the sandbox invented alone", () => {
    // Not a path on this side. Rewriting it would point the CLI at a
    // directory nobody asked for; left alone, the adapter reports it.
    const line = rewriteWorkspace(
      JSON.stringify({ method: "session/new", params: { cwd: "/etc" } }),
      "/host/mine",
    );

    expect(JSON.parse(line).params.cwd).toBe("/etc");
  });

  it("touches no other method, and passes a broken line through", () => {
    const prompt = JSON.stringify({
      method: "session/prompt",
      params: { cwd: SANDBOX_WORKSPACE },
    });

    expect(rewriteWorkspace(prompt, "/host/mine")).toBe(prompt);
    // Not ours to repair: the far side is the only place that can say what
    // it expected.
    expect(rewriteWorkspace("{not json", "/host/mine")).toBe("{not json");
  });
});

describe("the token", () => {
  it("accepts only the whole thing", () => {
    expect(tokenMatches("secret", "secret")).toBe(true);
    expect(tokenMatches("secre", "secret")).toBe(false);
    expect(tokenMatches("secretx", "secret")).toBe(false);
    expect(tokenMatches("", "secret")).toBe(false);
    expect(tokenMatches(undefined, "secret")).toBe(false);
  });
});

describe("a running bridge", () => {
  let bridge: Awaited<ReturnType<typeof startAntigravityBridge>> | null = null;

  afterEach(async () => {
    await bridge?.close();
    bridge = null;
  });

  it("will not start without a token", async () => {
    // An open port on the docker bridge is one any container on this host
    // could use.
    await expect(
      startAntigravityBridge({ token: "", command: ["cat"], log: () => {} }),
    ).rejects.toThrow(/needs a token/);
  });

  it("says on this side why it refused, not only down the socket", async () => {
    // The far side is an ACP client, which reports a refusal as "Connection
    // closed". A bridge that logs only its successes leaves the one case
    // worth explaining invisible on both ends.
    const said: string[] = [];
    bridge = await startAntigravityBridge({
      token: "right",
      command: ["cat"],
      host: "127.0.0.1",
      port: 0,
      docker: fakeDocker({ a: { ip: "10.9.9.9", workspace: "/w" } }),
      log: (line: string) => said.push(line),
    });
    const { port } = bridge.server.address() as { port: number };

    await new Promise<void>((resolve) => {
      const socket = net.connect(port, "127.0.0.1", () =>
        socket.write("right\n"),
      );
      socket.on("data", () => socket.destroy());
      socket.on("close", () => resolve());
    });

    expect(said.join("\n")).toMatch(/refused .*no container/);
  });

  it("refuses the wrong token before spawning anything", async () => {
    bridge = await startAntigravityBridge({
      token: "right",
      // `cat` would echo whatever reached it, so a reply here would prove the
      // adapter had been started for an unauthenticated caller.
      command: ["cat"],
      host: "127.0.0.1",
      port: 0,
      docker: fakeDocker({ a: { ip: "127.0.0.1", workspace: "/w" } }),
      log: () => {},
    });
    const { port } = bridge.server.address() as { port: number };

    const answer = await new Promise<string>((resolve) => {
      const socket = net.connect(port, "127.0.0.1", () => {
        socket.write("wrong\n");
        socket.write(
          '{"method":"session/new","params":{"cwd":"/workspace"}}\n',
        );
      });
      let seen = "";
      socket.on("data", (chunk) => {
        seen += chunk;
      });
      socket.on("close", () => resolve(seen));
    });

    expect(answer).toContain("not this bridge's");
    expect(answer).not.toContain("session/new");
  });

  it("waits for the rest of a line that arrived in pieces", async () => {
    // A TCP read is not a line. A long `session/prompt` arrives in several
    // chunks and the boundary lands wherever the network put it — this is the
    // failure a real run produced, as a JSONDecodeError in the adapter from
    // half a message.
    bridge = await startAntigravityBridge({
      token: "right",
      command: ["cat"],
      host: "127.0.0.1",
      port: 0,
      docker: fakeDocker({ a: { ip: "127.0.0.1", workspace: "/host/mine" } }),
      log: () => {},
    });
    const { port } = bridge.server.address() as { port: number };
    const message = JSON.stringify({
      method: "session/prompt",
      params: { text: "x".repeat(400) },
    });

    const echoed = await new Promise<string>((resolve) => {
      const socket = net.connect(port, "127.0.0.1", () => {
        socket.write("right\n");
        // Split where the network might, mid-message.
        socket.write(message.slice(0, 37));
        setTimeout(() => socket.write(`${message.slice(37)}\n`), 20);
      });
      let seen = "";
      socket.on("data", (chunk) => {
        seen += chunk;
        if (seen.includes("\n")) {
          resolve(seen);
          socket.destroy();
        }
      });
    });

    // One whole message reached the adapter, not two fragments.
    expect(JSON.parse(echoed.trim()).params.text).toHaveLength(400);
  });

  it("carries a session through once the token is right", async () => {
    bridge = await startAntigravityBridge({
      token: "right",
      command: ["cat"],
      host: "127.0.0.1",
      port: 0,
      docker: fakeDocker({ a: { ip: "127.0.0.1", workspace: "/host/mine" } }),
      log: () => {},
    });
    const { port } = bridge.server.address() as { port: number };

    const echoed = await new Promise<string>((resolve) => {
      const socket = net.connect(port, "127.0.0.1", () => {
        socket.write("right\n");
        socket.write(
          '{"method":"session/new","params":{"cwd":"/workspace"}}\n',
        );
      });
      socket.on("data", (chunk) => {
        resolve(String(chunk));
        socket.destroy();
      });
    });

    // `cat` echoes what the bridge handed the adapter, so this is the
    // rewritten line as the adapter would have received it.
    expect(JSON.parse(echoed).params.cwd).toBe("/host/mine");
  });
});
