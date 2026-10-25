// @vitest-environment node
/**
 * The sandbox half of the bridge, which travels inside a profile's command.
 *
 * A sandbox cannot see this repository, so the shim has to ride in
 * `acp_command` rather than exist as a file. That is no reason for it to be an
 * opaque blob somebody pasted into a shell once — and the first version of it
 * carried the bridge token baked in, which put a shared secret into a store
 * the agent server documents as secret-free at rest, readable by anyone who
 * can read a profile and unrotatable without rewriting one.
 *
 * Node project: it runs the generated program to check what it does when it
 * cannot work.
 */
import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import net from "node:net";
import { describe, expect, it } from "vitest";

import {
  BRIDGE_TOKEN_ENV,
  shimCommand,
  shimSource,
} from "../../scripts/antigravity-shim.mjs";

/** The host-side command every "the bridge is down" message points at. */
const BRIDGE_COMMAND = "oh-antigravity-bridge";

/** Run the generated program and return what it said and how it exited. */
function run(source: string, env: Record<string, string>) {
  try {
    execFileSync("python3", ["-c", source], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", ...env },
      timeout: 30000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { code: 0, stderr: "" };
  } catch (error) {
    const failure = error as { status?: number; stderr?: string };
    return { code: failure.status ?? -1, stderr: failure.stderr ?? "" };
  }
}

describe("the shim a sandbox runs", () => {
  it("carries no token, because a profile is not a secret store", () => {
    // The agent-profile store is secret-free at rest by design. A token baked
    // into a launch command is readable by anyone who can read a profile and
    // cannot be rotated without rewriting one.
    const source = shimSource();

    expect(source).toContain(`os.environ.get("${BRIDGE_TOKEN_ENV}")`);
    expect(source).not.toMatch(/[0-9a-f]{24,}/);
  });

  it("is the readable original, base64 only so it fits one field", () => {
    // Encoded so a multi-line program survives a single-string command field,
    // not to hide anything — so the two must agree.
    const encoded = /b64decode\('([^']+)'\)/.exec(shimCommand())?.[1] ?? "";

    expect(Buffer.from(encoded, "base64").toString("utf8")).toBe(shimSource());
  });

  it("ends the token with a real newline, not the letters backslash-n", async () => {
    // The bridge reads one line and compares it. A shim that writes the two
    // characters `\` and `n` instead sends a token the bridge never sees the
    // end of, then reads the first JSON-RPC line as part of it — which
    // surfaces as "that token is not this bridge's" and sent me looking at
    // the secret store rather than at an escaping level.
    const listener = net.createServer();
    await new Promise<void>((resolve) =>
      listener.listen(0, "127.0.0.1", resolve),
    );
    const { port } = listener.address() as net.AddressInfo;

    const firstLine = new Promise<string>((resolve) => {
      listener.once("connection", (socket) => {
        let seen = "";
        socket.on("data", (chunk) => {
          seen += chunk;
          const end = seen.indexOf("\n");
          if (end !== -1) {
            resolve(seen.slice(0, end));
            socket.destroy();
          }
        });
      });
    });

    const child = spawn(
      "python3",
      ["-c", shimSource({ host: "127.0.0.1", port })],
      {
        env: {
          PATH: process.env.PATH ?? "",
          [BRIDGE_TOKEN_ENV]: "sentinel-token",
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    try {
      expect(await firstLine).toBe("sentinel-token");
    } finally {
      child.kill();
      await new Promise<void>((resolve) => listener.close(() => resolve()));
    }
  });

  it("says where to put the token when it is missing", () => {
    // Without this it exits on a KeyError and the conversation reports an
    // opaque ACP startup failure, which is the same wall this whole bridge
    // exists to tear down.
    const { code, stderr } = run(shimSource(), {});

    expect(code).toBe(2);
    expect(stderr).toContain(BRIDGE_TOKEN_ENV);
    expect(stderr).toContain("secrets");
  });

  it("says the bridge is not running rather than failing on a socket", () => {
    // The bridge is a separate process on the host. "Connection refused" on
    // its own sends somebody to debug a network; naming the command to start
    // sends them to the actual fix.
    const { code, stderr } = run(shimSource({ host: "127.0.0.1", port: 9 }), {
      [BRIDGE_TOKEN_ENV]: "irrelevant",
    });

    expect(code).toBe(2);
    expect(stderr).toContain(BRIDGE_COMMAND);
    // And the command it names is one you can actually run: the message is
    // worthless if the binary is only reachable from a checkout.
    const manifest = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { bin: Record<string, string> };
    expect(manifest.bin).toHaveProperty(BRIDGE_COMMAND);
  });
});

describe("the command the bridge prints for a profile", () => {
  it("dials the endpoint the same invocation would listen on", () => {
    // Printing the command and starting the daemon read the host and port
    // from the same environment. A printed command that dials elsewhere
    // fails as "that token is not this bridge's", which reads like a
    // credential problem and sends you to the secret store instead.
    const env = {
      ...process.env,
      OH_ANTIGRAVITY_BRIDGE_HOST: "10.1.2.3",
      OH_ANTIGRAVITY_BRIDGE_PORT: "9123",
    };

    const printed = execFileSync(
      process.execPath,
      ["bin/oh-antigravity-bridge.mjs", "--profile-command"],
      { encoding: "utf8", env, timeout: 30000 },
    );

    const encoded = /b64decode\('([^']+)'\)/.exec(printed)?.[1] ?? "";
    const source = Buffer.from(encoded, "base64").toString("utf8");
    expect(source).toContain('create_connection(("10.1.2.3",9123)');
  });
});
