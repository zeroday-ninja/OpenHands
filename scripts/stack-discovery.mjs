/**
 * Find the Agent Canvas stack a host-side process should talk to.
 *
 * Nothing documented this, which is why every host-side tool so far has
 * hard-coded a port and a key path. The rules below are the ones the launchers
 * already follow; writing them down once is what lets a second process — the
 * terminal interface, a script, a probe — reach the same stack the browser is
 * looking at.
 *
 * Resolution order, most explicit first:
 *
 *   1. `OH_STACK_URL` and `OH_STACK_API_KEY`, for a stack somewhere else
 *      entirely. Given one and not the other, the other is still resolved
 *      below: pointing at a remote host does not mean you want a different
 *      key.
 *   2. `LOCAL_BACKEND_API_KEY`, which the launchers already honour as the
 *      pinned key.
 *   3. `~/.openhands/agent-canvas/api-key.txt`, which the launcher writes so
 *      that the agent-server, the Vite build and the browser all agree.
 *   4. `config/defaults.json`'s proxy port on loopback.
 *
 * A stack that cannot be found is reported with what was tried, because "could
 * not connect" without the URL is the bug report nobody can act on.
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Where the launcher persists the session key. */
export const API_KEY_PATH = path.join(
  homedir(),
  ".openhands",
  "agent-canvas",
  "api-key.txt",
);

/** How long to wait for `/server_info` before calling the stack absent. */
export const PROBE_TIMEOUT_MS = 4000;

export class StackNotFound extends Error {
  /** @param {string[]} tried */
  constructor(tried) {
    super(
      `No Agent Canvas stack answered. Tried:\n  ${tried.join("\n  ")}\n` +
        "Start one with `npm run dev`, or point OH_STACK_URL at a running one.",
    );
    this.name = "StackNotFound";
    this.tried = tried;
  }
}

async function defaultProxyPort() {
  try {
    const raw = await readFile(
      path.join(HERE, "..", "config", "defaults.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw);
    const port = parsed?.ports?.proxy;
    return typeof port === "number" ? port : 8000;
  } catch {
    // A missing or unreadable defaults file is not a reason to fail: the
    // committed value has been 8000 throughout, and guessing it is better
    // than refusing to look.
    return 8000;
  }
}

async function readKeyFile() {
  try {
    const raw = await readFile(API_KEY_PATH, "utf8");
    return raw.trim() || null;
  } catch {
    return null;
  }
}

/**
 * The session key a host-side process should send, or null.
 *
 * @returns {Promise<string | null>}
 */
export async function resolveApiKey(env = process.env) {
  return (
    env.OH_STACK_API_KEY?.trim() ||
    env.LOCAL_BACKEND_API_KEY?.trim() ||
    (await readKeyFile())
  );
}

/**
 * Ask one base URL whether it is a stack.
 *
 * @returns {Promise<{ ok: true, info: object } | { ok: false, reason: string }>}
 */
export async function probeStack(baseUrl, apiKey, timeoutMs = PROBE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(new URL("/server_info", baseUrl), {
      headers: apiKey ? { "X-Session-API-Key": apiKey } : {},
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, reason: `HTTP ${response.status}` };
    }
    return { ok: true, info: await response.json() };
  } catch (error) {
    return { ok: false, reason: error?.name === "AbortError" ? "timed out" : String(error?.message || error) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @typedef {object} Stack
 * @property {string} baseUrl    Where the stack answers, with no trailing slash.
 * @property {string | null} apiKey
 * @property {object} info       Whatever `/server_info` returned.
 * @property {boolean} automation True when the automation service is reachable
 *                                through this stack, which decides whether the
 *                                work graph and parked work are available.
 */

/**
 * Find the stack, or throw `StackNotFound` naming everything that was tried.
 *
 * @returns {Promise<Stack>}
 */
export async function discoverStack(env = process.env) {
  const apiKey = await resolveApiKey(env);
  const candidates = [];
  if (env.OH_STACK_URL?.trim()) {
    candidates.push(env.OH_STACK_URL.trim().replace(/\/$/, ""));
  } else {
    const port = await defaultProxyPort();
    // Both spellings: a stack bound to ::1 does not answer on 127.0.0.1 and
    // the reverse, and which one the launcher chose depends on the host.
    candidates.push(`http://127.0.0.1:${port}`, `http://[::1]:${port}`);
  }

  const tried = [];
  for (const baseUrl of candidates) {
    // Sequential on purpose: these are alternatives, and racing them would
    // make the reported failure depend on which one lost.
    // eslint-disable-next-line no-await-in-loop
    const result = await probeStack(baseUrl, apiKey);
    if (result.ok) {
      return {
        baseUrl,
        apiKey,
        info: result.info,
        automation: hasAutomation(result.info),
      };
    }
    tried.push(`${baseUrl}/server_info — ${result.reason}`);
  }
  throw new StackNotFound(tried);
}

/**
 * Whether the automation service is reachable through this stack.
 *
 * Read from `runtime_services.services` rather than probed, because that block
 * is what the stack itself says it is serving — and a probe that got a 404
 * cannot tell "not running" from "running and this path is wrong".
 *
 * The shape is the one `/server_info` actually returns:
 * `{ mode, agent_host_alias, services: { agent_server: {...}, automation: {...} } }`.
 * A top-level `services` map is also accepted, because that is what the block
 * looked like before it grew its envelope and an older stack still sends it.
 */
export function hasAutomation(info) {
  const block = info?.runtime_services;
  if (!block || typeof block !== "object") return false;
  const services =
    block.services && typeof block.services === "object"
      ? block.services
      : block;
  return Object.prototype.hasOwnProperty.call(services, "automation");
}
