/**
 * Bind-address helpers for the local Agent Canvas stack.
 *
 * Default is IPv4 loopback. Binding `::` / `0.0.0.0` exposes the UI (and any
 * session key injected into index.html) to every peer on the network.
 */

import { spawnSync } from "node:child_process";
import { networkInterfaces } from "node:os";

export const DEFAULT_BIND_HOST = "127.0.0.1";

const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * Find the address Docker conversation sandboxes reach as
 * `host.docker.internal`: the SDK starts them with
 * `--add-host host.docker.internal:host-gateway`, and Docker resolves
 * `host-gateway` to the default bridge's gateway.
 *
 * Returns the gateway only when it is assigned to an interface on this host,
 * i.e. when a listener here can bind it (native Docker Engine on Linux or in
 * WSL). Docker Desktop keeps the bridge inside its VM, so this returns null
 * there, as it does when the docker CLI is missing or the daemon is down.
 *
 * @param {object} [deps]
 * @param {(cmd: string, args: string[]) => {status: number | null, stdout?: string, error?: Error}} [deps.run]
 * @param {() => Record<string, Array<{address: string}> | undefined>} [deps.interfaces]
 * @returns {string | null}
 */
export function detectDockerBridgeHost({
  run = (cmd, args) =>
    spawnSync(cmd, args, { encoding: "utf8", timeout: 5000 }),
  interfaces = networkInterfaces,
} = {}) {
  const result = run("docker", [
    "network",
    "inspect",
    "bridge",
    "--format",
    "{{range .IPAM.Config}}{{.Gateway}} {{end}}",
  ]);
  if (result.error || result.status !== 0) return null;

  const gateways = String(result.stdout ?? "")
    .trim()
    .split(/\s+/)
    .filter((address) => IPV4_RE.test(address));
  const localAddresses = new Set(
    Object.values(interfaces())
      .flatMap((addrs) => addrs ?? [])
      .map((addr) => addr.address),
  );
  return gateways.find((address) => localAddresses.has(address)) ?? null;
}

const STATIC_LOOPBACK_HOSTS = new Set(["::1", "localhost"]);
const IPV4_LOOPBACK_RE = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

export function isLoopbackBind(host) {
  if (host == null || host === "") return false;
  const normalized = String(host)
    .trim()
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
  return STATIC_LOOPBACK_HOSTS.has(normalized) || IPV4_LOOPBACK_RE.test(normalized);
}

/**
 * Resolve the listen address.
 * CLI `--host` wins, then `OH_BIND_HOST`, then loopback.
 */
export function resolveBindHost({ flag, env } = {}) {
  const fromFlag =
    flag != null && String(flag).trim() !== "" ? String(flag).trim() : null;
  const fromEnv =
    env != null && String(env).trim() !== "" ? String(env).trim() : null;
  return fromFlag || fromEnv || DEFAULT_BIND_HOST;
}

export function bindHostArgs(host) {
  return ["--host", host || DEFAULT_BIND_HOST];
}

/**
 * Session keys must not be written into unauthenticated HTML when the
 * listener is reachable off-loopback. Convert to public-mode (`authRequired`)
 * unless the caller explicitly opts back in (container entrypoints).
 *
 * @param {object} [opts]
 * @param {string} [opts.host]
 * @param {string | null} [opts.sessionApiKey]
 * @param {boolean} [opts.authRequired]
 * @param {boolean} [opts.allowLanSessionKey]
 * @param {(msg: string) => void} [opts.warn]
 */
export function applySessionKeyPolicy(opts = {}) {
  const {
    host,
    sessionApiKey = null,
    authRequired = false,
    allowLanSessionKey = false,
    warn = console.warn,
  } = opts;
  const loopback = isLoopbackBind(host);
  if (loopback || allowLanSessionKey || !sessionApiKey) {
    return {
      sessionApiKey: sessionApiKey || null,
      authRequired: Boolean(authRequired),
      strippedSessionKey: false,
    };
  }

  warn(
    `WARNING: bind host ${host} is not loopback; refusing to inject the session API key into HTML.\n` +
      "  The UI will use the API key entry screen (same as --public).\n" +
      "  Pass --host 127.0.0.1 (default) for local mode, or --allow-lan-session-key only if you accept LAN exposure.",
  );

  return {
    sessionApiKey: null,
    authRequired: true,
    strippedSessionKey: true,
  };
}
