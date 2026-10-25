/**
 * Let a sandbox use Antigravity without ever holding its credential.
 *
 * `agy` keeps its Google login in the desktop keyring. A container has no
 * keyring, so the adapter running inside one cannot sign in — and the usual
 * fixes are both wrong: copying the token into the sandbox puts a broad-scope
 * Google refresh token next to agent-written code, and baking the CLI into
 * the image redistributes a vendor binary and still needs the token.
 *
 * So the credential stays where it already is. This runs the adapter *on the
 * host*, where it is already signed in, and the sandbox reaches it over the
 * bridge the launcher already uses. The same shape as the access gate: hold
 * the secret behind the boundary and pass only the conversation across it.
 *
 * What crosses is ACP's own JSON-RPC, one line at a time, and the only thing
 * rewritten is the working directory — the sandbox calls it `/workspace`, and
 * on this side it is a real path under the launcher's workspaces directory.
 * That path is read from Docker rather than configured, because guessing it
 * would silently give a conversation somebody else's files.
 */

import { execFile } from "node:child_process";
import net from "node:net";
import { spawn } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Where the daemon listens. The docker bridge, never every interface. */
export const DEFAULT_BRIDGE_HOST = "172.17.0.1";
export const DEFAULT_BRIDGE_PORT = 8771;

/** The path a sandbox calls its workspace. */
export const SANDBOX_WORKSPACE = "/workspace";

export class BridgeRefused extends Error {
  constructor(message) {
    super(message);
    this.name = "BridgeRefused";
  }
}

/**
 * The host directory a container sees as `/workspace`.
 *
 * Read from Docker by the peer's address rather than configured: a wrong or
 * stale mapping would hand a conversation another conversation's files, and
 * an answer that cannot be derived is refused rather than guessed.
 *
 * @param {string} peerAddress
 * @param {(args: string[]) => Promise<string>} docker
 */
export async function workspaceForPeer(peerAddress, docker = dockerCli) {
  const address = String(peerAddress ?? "").replace(/^::ffff:/, "");
  if (!address) throw new BridgeRefused("the connection has no peer address");
  const listed = await docker(["ps", "--quiet", "--filter", `network=bridge`]);
  for (const id of listed
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)) {
    const inspected = await docker([
      "inspect",
      id,
      "--format",
      "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}|" +
        `{{range .Mounts}}{{if eq .Destination "${SANDBOX_WORKSPACE}"}}{{.Source}}{{end}}{{end}}`,
    ]);
    const [ip, source] = inspected.trim().split("|");
    if (ip !== address) continue;
    if (!source) {
      throw new BridgeRefused(
        `the container at ${address} has no ${SANDBOX_WORKSPACE} mount, so ` +
          "there is no directory on this side to give it",
      );
    }
    return source;
  }
  throw new BridgeRefused(
    `no container on the docker bridge has the address ${address}; only a ` +
      "sandbox on this host may use the bridge",
  );
}

async function dockerCli(args) {
  const { stdout } = await run("docker", args, { timeout: 15000 });
  return stdout;
}

/**
 * One line of ACP, with the sandbox's workspace path swapped for the host's.
 *
 * Only `session/new`'s `cwd`, and only when it is the workspace: a path the
 * sandbox invented is not a path on this side, and rewriting it would point
 * the CLI at a directory nobody asked for.
 *
 * @param {string} line
 * @param {string} hostWorkspace
 */
export function rewriteWorkspace(line, hostWorkspace) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    // Not ours to repair. Passed through so the far side reports it, which is
    // the only place that can say what it expected.
    return line;
  }
  if (message?.method !== "session/new") return line;
  const cwd = message?.params?.cwd;
  if (typeof cwd !== "string") return line;
  if (cwd !== SANDBOX_WORKSPACE && !cwd.startsWith(`${SANDBOX_WORKSPACE}/`)) {
    return line;
  }
  message.params.cwd = hostWorkspace + cwd.slice(SANDBOX_WORKSPACE.length);
  return JSON.stringify(message);
}

/** Constant-time compare, so a token cannot be found one character at a time. */
export function tokenMatches(offered, expected) {
  const a = Buffer.from(String(offered ?? ""), "utf8");
  const b = Buffer.from(String(expected ?? ""), "utf8");
  if (a.length === 0 || a.length !== b.length) return false;
  let same = 0;
  for (let i = 0; i < a.length; i += 1) same |= a[i] ^ b[i];
  return same === 0;
}

/**
 * Serve the adapter to sandboxes on the docker bridge.
 *
 * @param {object} config
 * @param {string} config.token      Shared with the sandbox through its secrets.
 * @param {string[]} config.command  How to start the adapter on this host.
 * @param {string} [config.host]
 * @param {number} [config.port]
 * @param {(args: string[]) => Promise<string>} [config.docker]
 * @param {(message: string) => void} [config.log]
 * @returns {Promise<{ server: import("node:net").Server, close: () => Promise<void> }>}
 */
export async function startAntigravityBridge({
  token,
  command,
  host = DEFAULT_BRIDGE_HOST,
  port = DEFAULT_BRIDGE_PORT,
  docker = dockerCli,
  log = console.log,
} = {}) {
  if (!token) {
    throw new BridgeRefused(
      "the bridge needs a token; an open port on the docker bridge is one " +
        "any container on this host could use",
    );
  }

  const server = net.createServer((socket) => {
    void serve(socket).catch((error) => {
      const reason = String(error?.message ?? error);
      // Said here, not only down the socket. The far side is an ACP client
      // that reports a refusal as "Connection closed", so a bridge that logs
      // only its successes leaves the one case worth explaining invisible on
      // both ends.
      log(`  refused ${socket.remoteAddress ?? "a connection"}: ${reason}`);
      socket.end(
        `${JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: reason } })}\n`,
      );
    });
  });

  async function serve(socket) {
    socket.setNoDelay(true);
    const peer = socket.remoteAddress;
    let buffered = "";
    let child = null;
    let hostWorkspace = null;

    const firstLine = await new Promise((resolve, reject) => {
      const onData = (chunk) => {
        buffered += chunk;
        const index = buffered.indexOf("\n");
        if (index === -1) return;
        socket.off("data", onData);
        const line = buffered.slice(0, index);
        buffered = buffered.slice(index + 1);
        resolve(line);
      };
      socket.on("data", onData);
      socket.once("error", reject);
      socket.setTimeout(10000, () =>
        reject(new BridgeRefused("the connection sent no token")),
      );
    });

    if (!tokenMatches(firstLine.trim(), token)) {
      throw new BridgeRefused("that token is not this bridge's");
    }
    socket.setTimeout(0);

    hostWorkspace = await workspaceForPeer(peer, docker);
    log(`  ${peer} -> ${hostWorkspace}`);

    child = spawn(command[0], command.slice(1), {
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdout.pipe(socket);
    // The adapter's stderr is the CLI's own diagnostics. Kept on this side:
    // it is where a refusal's status code lands, and the sandbox has no use
    // for it that is worth widening the channel for.
    child.stderr.on("data", (chunk) =>
      log(`  agy: ${String(chunk).trimEnd()}`),
    );

    // A TCP read is not a line. A long `session/prompt` arrives in several
    // chunks and the boundary lands wherever the network put it, so anything
    // after the last newline is held until the rest of it turns up --
    // forwarding half a line gives the adapter a JSON fragment to parse.
    let pending = buffered;
    const forward = (text) => {
      pending += text;
      let index = pending.indexOf("\n");
      while (index !== -1) {
        const line = pending.slice(0, index);
        pending = pending.slice(index + 1);
        if (line.trim()) {
          child.stdin.write(`${rewriteWorkspace(line, hostWorkspace)}\n`);
        }
        index = pending.indexOf("\n");
      }
    };
    if (pending) {
      const carried = pending;
      pending = "";
      forward(carried);
    }
    socket.on("data", (chunk) => forward(String(chunk)));

    const stop = () => {
      socket.destroy();
      if (child && child.exitCode === null) child.kill();
    };
    socket.on("close", stop);
    child.on("exit", () => socket.end());
  }

  await new Promise((resolve) => server.listen(port, host, resolve));
  log(`Antigravity bridge on ${host}:${port}`);
  log("  the credential stays on this host; only the conversation crosses");
  return {
    server,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
