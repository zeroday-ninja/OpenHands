/**
 * Self-update and restart of a locally launched Agent Canvas stack.
 *
 * The launcher (scripts/dev-with-automation.mjs) works out how this copy of
 * Agent Canvas was installed, advertises that through the ingress on
 * `/server_info.agent_canvas_control`, and on request updates the install
 * and replaces itself: every service is stopped, a fresh launcher is spawned
 * with the same command line, and this process exits. The browser polls the
 * ingress until the new stack answers with a different instance id, then
 * reloads (the pattern clockwork-quill uses for its "restart server" button).
 *
 * Install methods:
 *   - "git-checkout": running from a source checkout (`npm run dev`,
 *     `dev:static`). Update = `git pull --ff-only` on the current branch and
 *     `npm ci` when the pull moved HEAD.
 *   - "npm-global": the published package under a node_modules tree
 *     (`npm install -g @openhands/agent-canvas`). Update =
 *     `npm install -g @openhands/agent-canvas@latest`; the relaunch runs the
 *     same bin path, now holding the new version.
 *   - "npx": the package in npx's cache. There is nothing to update in place;
 *     the relaunch runs `npm exec -- @openhands/agent-canvas@latest`, which
 *     fetches the latest release.
 *
 * Only an auto-keyed loopback stack offers the control routes: `--public` and
 * non-loopback binds don't inject the session key the routes require, and a
 * sandbox-facing ingress never gets them at all.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, sep } from "node:path";
import process from "node:process";

import { resolveWindowsCommand } from "./dev-process-utils.mjs";

export const AGENT_CANVAS_PACKAGE = "@openhands/agent-canvas";
export const CONTROL_PATH_PREFIX = "/__agent-canvas";
export const CONTROL_STATUS_PATH = `${CONTROL_PATH_PREFIX}/status`;
export const CONTROL_UPDATE_PATH = `${CONTROL_PATH_PREFIX}/update`;
export const CONTROL_RESTART_PATH = `${CONTROL_PATH_PREFIX}/restart`;
/** Header the control routes authenticate with (the stack's session key). */
export const CONTROL_KEY_HEADER = "x-session-api-key";

/** IPC messages between the ingress child and the launcher. */
export const CONTROL_REQUEST_MESSAGE = "agent-canvas-control";
export const CONTROL_STATUS_MESSAGE = "agent-canvas-control-status";

const OUTPUT_TAIL_CHARS = 2000;

function hasPathSegment(path, segment) {
  return path.split(sep).includes(segment);
}

function unsupported(reason) {
  return { supported: false, method: null, reason };
}

/**
 * Work out whether, and how, this stack can update and restart itself.
 *
 * @param {{
 *   projectRoot: string,
 *   version: string,
 *   isPublic?: boolean,
 *   isLoopback?: boolean,
 *   desktop?: boolean,
 *   argv?: string[],
 *   execArgv?: string[],
 *   execPath?: string,
 *   cwd?: string,
 *   platform?: NodeJS.Platform,
 *   packageName?: string,
 * }} options
 * @returns {{
 *   version: string,
 *   self_update: { supported: boolean, method: string|null, reason: string|null },
 *   restart: { supported: boolean, reason: string|null },
 *   relaunch: { command: string, args: string[], cwd: string } | null,
 * }}
 */
export function detectSelfUpdate({
  projectRoot,
  version,
  isPublic = false,
  isLoopback = true,
  desktop = false,
  argv = process.argv,
  execArgv = process.execArgv,
  execPath = process.execPath,
  cwd = process.cwd(),
  platform = process.platform,
  packageName = AGENT_CANVAS_PACKAGE,
}) {
  const base = { version, relaunch: null };
  if (desktop) {
    return {
      ...base,
      self_update: unsupported("desktop"),
      restart: { supported: false, reason: "desktop" },
    };
  }
  if (isPublic || !isLoopback) {
    return {
      ...base,
      self_update: unsupported("public"),
      restart: { supported: false, reason: "public" },
    };
  }

  const sameCommandLine = {
    command: execPath,
    args: [...execArgv, ...argv.slice(1)],
    cwd,
  };

  if (existsSync(join(projectRoot, ".git"))) {
    return {
      ...base,
      self_update: { supported: true, method: "git-checkout", reason: null },
      restart: { supported: true, reason: null },
      relaunch: sameCommandLine,
    };
  }
  if (hasPathSegment(projectRoot, "_npx")) {
    return {
      ...base,
      self_update: { supported: true, method: "npx", reason: null },
      restart: { supported: true, reason: null },
      relaunch: {
        command: resolveWindowsCommand("npm", platform),
        args: [
          "exec",
          "--yes",
          "--",
          `${packageName}@latest`,
          ...argv.slice(2),
        ],
        cwd,
      },
    };
  }
  if (
    hasPathSegment(projectRoot, "node_modules") &&
    projectRoot.endsWith(join("@openhands", "agent-canvas"))
  ) {
    return {
      ...base,
      self_update: { supported: true, method: "npm-global", reason: null },
      restart: { supported: true, reason: null },
      relaunch: sameCommandLine,
    };
  }
  return {
    ...base,
    self_update: unsupported("unknown-install"),
    restart: { supported: true, reason: null },
    relaunch: sameCommandLine,
  };
}

/** The browser-facing summary of a detection, for `/server_info`. */
export function toControlInfo(detection) {
  return {
    version: detection.version,
    self_update: detection.self_update,
    restart: detection.restart,
    status_path: CONTROL_STATUS_PATH,
    update_path: CONTROL_UPDATE_PATH,
    restart_path: CONTROL_RESTART_PATH,
  };
}

/**
 * @param {{ command: string, args: string[], cwd: string }} step
 * @param {UpdateRunOptions} [options]
 * @returns {Promise<{ ok: boolean, output: string, code?: number|null }>}
 */
function runStep(step, { spawnImpl = spawn, env = process.env } = {}) {
  return new Promise((resolvePromise) => {
    let output = "";
    const append = (chunk) => {
      output = (output + chunk.toString()).slice(-OUTPUT_TAIL_CHARS);
    };
    let child;
    try {
      child = spawnImpl(step.command, step.args, {
        cwd: step.cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      });
    } catch (error) {
      resolvePromise({ ok: false, output: error.message });
      return;
    }
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.on("error", (error) => {
      resolvePromise({
        ok: false,
        output: `${output}\n${error.message}`.trim(),
      });
    });
    child.on("exit", (code) => {
      resolvePromise({ ok: code === 0, output: output.trim(), code });
    });
  });
}

/**
 * @typedef {object} UpdateStep
 * @property {string} label
 * @property {string} command
 * @property {string[]} args
 * @property {string} cwd
 * @property {boolean} [onlyIfHeadMoved]
 */

/**
 * @typedef {object} UpdateRunOptions
 * @property {string} [projectRoot]
 * @property {(line: string) => void} [log]
 * @property {SpawnLike} [spawnImpl]
 * @property {NodeJS.ProcessEnv} [env]
 * @property {NodeJS.Platform} [platform]
 */

/**
 * The subset of `child_process.spawn` these helpers use; tests pass doubles.
 * @typedef {(command: string, args: string[], options?: object) => any} SpawnLike
 */

/**
 * The commands an update runs, in order, for a detection. `npx` has none:
 * its relaunch fetches the latest release by itself.
 *
 * @param {ReturnType<typeof detectSelfUpdate>} detection
 * @param {{ projectRoot?: string, platform?: NodeJS.Platform, packageName?: string }} [options]
 * @returns {UpdateStep[]}
 */
export function buildUpdateSteps(
  detection,
  {
    projectRoot,
    platform = process.platform,
    packageName = AGENT_CANVAS_PACKAGE,
  } = {},
) {
  switch (detection.self_update.method) {
    case "git-checkout": {
      const git = resolveWindowsCommand("git", platform);
      const npm = resolveWindowsCommand("npm", platform);
      return [
        {
          label: "git pull",
          command: git,
          args: ["pull", "--ff-only"],
          cwd: projectRoot,
        },
        {
          label: "npm ci",
          command: npm,
          args: ["ci", "--no-audit", "--no-fund"],
          cwd: projectRoot,
          // Only when the pull moved HEAD; a no-op pull keeps node_modules.
          onlyIfHeadMoved: true,
        },
      ];
    }
    case "npm-global":
      return [
        {
          label: "npm install -g",
          command: resolveWindowsCommand("npm", platform),
          args: [
            "install",
            "-g",
            "--no-audit",
            "--no-fund",
            `${packageName}@latest`,
          ],
          cwd: projectRoot,
        },
      ];
    default:
      return [];
  }
}

async function gitHead(projectRoot, options) {
  const result = await runStep(
    {
      command: resolveWindowsCommand(
        "git",
        options.platform ?? process.platform,
      ),
      args: ["rev-parse", "HEAD"],
      cwd: projectRoot,
    },
    options,
  );
  return result.ok ? result.output : null;
}

/**
 * Run the update for a detection. Resolves `{ ok, message }`; `message` is
 * the last lines of output, for the browser to show. Never throws.
 *
 * @param {ReturnType<typeof detectSelfUpdate>} detection
 * @param {UpdateRunOptions} [options]
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
export async function runSelfUpdate(
  detection,
  { projectRoot, log = () => {}, spawnImpl, env, platform } = {},
) {
  if (!detection.self_update.supported) {
    return {
      ok: false,
      message: `Self-update is not available (${detection.self_update.reason}).`,
    };
  }
  const options = { spawnImpl, env, platform };
  const steps = buildUpdateSteps(detection, { projectRoot, platform });
  const headBefore =
    detection.self_update.method === "git-checkout"
      ? await gitHead(projectRoot, options)
      : null;
  let lastOutput = "";
  for (const step of steps) {
    if (step.onlyIfHeadMoved) {
      const headAfter = await gitHead(projectRoot, options);
      if (headBefore && headAfter && headAfter === headBefore) {
        log(`${step.label}: skipped, the checkout did not change`);
        continue;
      }
    }
    log(`${step.label}: running`);
    const result = await runStep(step, options);
    lastOutput = result.output;
    if (!result.ok) {
      log(`${step.label}: failed`);
      return {
        ok: false,
        message: `${step.label} failed${result.code != null ? ` (exit ${result.code})` : ""}: ${result.output || "no output"}`,
      };
    }
    log(`${step.label}: done`);
  }
  return { ok: true, message: lastOutput };
}

/**
 * Start the replacement launcher. It inherits this process's stdio so its
 * output lands where ours did (the terminal or the log the stack was started
 * into), and runs detached so it survives our exit.
 */
/**
 * @param {{ command: string, args: string[], cwd: string }} relaunch
 * @param {{ spawnImpl?: SpawnLike, env?: NodeJS.ProcessEnv }} [options]
 */
export function spawnRelaunch(
  relaunch,
  { spawnImpl = spawn, env = process.env } = {},
) {
  const child = spawnImpl(relaunch.command, relaunch.args, {
    cwd: relaunch.cwd,
    env,
    stdio: "inherit",
    detached: process.platform !== "win32",
  });
  child.unref();
  return child;
}
