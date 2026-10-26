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
import { existsSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import process from "node:process";

import { resolveWindowsCommand } from "./dev-process-utils.mjs";

export const AGENT_CANVAS_PACKAGE = "@openhands/agent-canvas";
/** Where a source checkout fetches release tags from (`v<version>`). */
export const AGENT_CANVAS_UPSTREAM_REPO =
  "https://github.com/OpenHands/OpenHands.git";
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

/** Numeric semver compare: negative when `a` is older than `b`. */
export function compareVersions(a, b) {
  const parse = (value) =>
    String(value ?? "")
      .trim()
      .replace(/^v/, "")
      .split(/[.-]/)
      .slice(0, 3)
      .map((part) => Number.parseInt(part, 10) || 0);
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  }
  return 0;
}

/**
 * The npm prefix a global install under `projectRoot` belongs to, so the
 * update lands in the same tree the running bin came from (not whatever
 * prefix the shell's npm would pick). Null when the layout is not npm's.
 */
export function npmPrefixOf(projectRoot, platform = process.platform) {
  const parts = projectRoot.split(sep);
  const tail = platform === "win32" ? 3 : 4; // [lib/]node_modules/@openhands/agent-canvas
  const expected =
    platform === "win32"
      ? ["node_modules", "@openhands", "agent-canvas"]
      : ["lib", "node_modules", "@openhands", "agent-canvas"];
  if (parts.slice(-tail).join("/") !== expected.join("/")) return null;
  return parts.slice(0, -tail).join(sep) || sep;
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
 * @property {string} [onlyIfOlderThan]
 * @property {string} [mergeTag]
 */

/**
 * @typedef {object} UpdateRunOptions
 * @property {string} [projectRoot]
 * @property {(line: string) => void} [log]
 * @property {SpawnLike} [spawnImpl]
 * @property {NodeJS.ProcessEnv} [env]
 * @property {NodeJS.Platform} [platform]
 * @property {string|null} [targetVersion] The release the browser saw on npm;
 *   a checkout older than it merges that release's tag.
 * @property {string} [upstreamRepo] Where release tags are fetched from.
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
    case "npm-global": {
      // Install into the prefix the running bin lives in, not whatever the
      // shell's npm would pick (nvm users have one per Node version).
      const prefix = projectRoot ? npmPrefixOf(projectRoot, platform) : null;
      return [
        {
          label: "npm install -g",
          command: resolveWindowsCommand("npm", platform),
          args: [
            "install",
            "-g",
            "--no-audit",
            "--no-fund",
            ...(prefix ? ["--prefix", prefix] : []),
            `${packageName}@latest`,
          ],
          cwd: projectRoot,
        },
      ];
    }
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
  {
    projectRoot,
    log = () => {},
    spawnImpl,
    env,
    platform,
    targetVersion = null,
    upstreamRepo = AGENT_CANVAS_UPSTREAM_REPO,
  } = {},
) {
  if (!detection.self_update.supported) {
    return {
      ok: false,
      message: `Self-update is not available (${detection.self_update.reason}).`,
    };
  }
  const options = {
    spawnImpl,
    // Never let git sit on a credential prompt nobody can answer.
    env: { ...(env ?? process.env), GIT_TERMINAL_PROMPT: "0" },
    platform,
  };
  const git = resolveWindowsCommand("git", platform ?? process.platform);
  const isCheckout = detection.self_update.method === "git-checkout";
  let steps = buildUpdateSteps(detection, { projectRoot, platform });
  let headBefore = null;
  if (isCheckout) {
    const dirty = await runStep(
      { command: git, args: ["status", "--porcelain"], cwd: projectRoot },
      options,
    );
    if (dirty.ok && dirty.output) {
      return {
        ok: false,
        message:
          "The checkout has uncommitted changes. Commit or stash them, then try again.",
      };
    }
    headBefore = await gitHead(projectRoot, options);
    // A detached HEAD or a branch without an upstream has nothing to pull;
    // the release-tag merge below still applies.
    const tracking = await runStep(
      {
        command: git,
        args: ["rev-parse", "--abbrev-ref", "@{u}"],
        cwd: projectRoot,
      },
      options,
    );
    if (!tracking.ok) {
      log("git pull: skipped, the branch tracks no upstream");
      steps = steps.filter((step) => step.label !== "git pull");
    }
    if (targetVersion) {
      // After the pull and before npm ci: fetch the release tag, then merge
      // it (see the loop), unless the checkout already carries that version.
      // The tag is fetched into FETCH_HEAD only: creating a local tag could
      // clash with one the checkout already carries under that name.
      steps.splice(steps.length - 1, 0, {
        label: `merge release v${targetVersion}`,
        command: git,
        args: [
          "fetch",
          "--no-tags",
          upstreamRepo,
          `refs/tags/v${targetVersion}`,
        ],
        cwd: projectRoot,
        mergeTag: `v${targetVersion}`,
        onlyIfOlderThan: targetVersion,
      });
    }
  }
  let lastOutput = "";
  for (const step of steps) {
    if (step.onlyIfOlderThan) {
      const installed = readPackageVersion(projectRoot);
      if (installed && compareVersions(installed, step.onlyIfOlderThan) >= 0) {
        log(`${step.label}: skipped, the checkout is already ${installed}`);
        continue;
      }
    }
    if (step.onlyIfHeadMoved) {
      const headAfter = await gitHead(projectRoot, options);
      if (headBefore && headAfter && headAfter === headBefore) {
        log(`${step.label}: skipped, the checkout did not change`);
        continue;
      }
    }
    log(`${step.label}: running`);
    let result = await runStep(step, options);
    if (result.ok && step.mergeTag) {
      // The fetch brought the tag; now merge it into the current branch. A
      // conflict is undone so the checkout is left as it was. The merge
      // commit needs an identity; a checkout without one gets a stand-in.
      const identity = await runStep(
        { command: git, args: ["config", "user.email"], cwd: projectRoot },
        options,
      );
      const mergeOptions =
        identity.ok && identity.output
          ? options
          : {
              ...options,
              env: {
                ...options.env,
                GIT_AUTHOR_NAME: "Agent Canvas",
                GIT_AUTHOR_EMAIL: "agent-canvas@localhost",
                GIT_COMMITTER_NAME: "Agent Canvas",
                GIT_COMMITTER_EMAIL: "agent-canvas@localhost",
              },
            };
      result = await runStep(
        {
          command: git,
          args: [
            "merge",
            "--no-ff",
            "-m",
            `Merge release ${step.mergeTag} from ${upstreamRepo}`,
            "FETCH_HEAD",
          ],
          cwd: projectRoot,
        },
        mergeOptions,
      );
      if (!result.ok) {
        await runStep(
          { command: git, args: ["merge", "--abort"], cwd: projectRoot },
          options,
        );
      }
    }
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

function readPackageVersion(projectRoot) {
  try {
    const raw = readFileSync(join(projectRoot, "package.json"), "utf8");
    const version = JSON.parse(raw).version;
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

/**
 * The names a `.env` file defines, so a relaunch can let the file speak again.
 *
 * Node's `--env-file` never overrides a variable that is already set, and a
 * relaunch inherits this process's environment — which carries every value
 * the file set at the *previous* start. So an edit to `.env` (a new sandbox
 * image pin, say) survived "Restart" only in the file: the relaunched stack
 * ran on the old value until someone stopped it by hand. Dropping the file's
 * own names from the inherited environment lets the new launcher read them
 * fresh; a value set outside the file (the shell, a service unit) still wins,
 * because it is not in the file.
 *
 * @param {string} envFile
 * @returns {Set<string>}
 */
export function envFileNames(envFile) {
  const names = new Set();
  if (!existsSync(envFile)) return names;
  for (const raw of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (match) names.add(match[1]);
  }
  return names;
}

/**
 * This process's environment with the `.env` file's own names removed, which
 * is what the replacement launcher must start from. See {@link envFileNames}.
 *
 * @param {string} cwd where the launcher runs, and where its `.env` is
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {NodeJS.ProcessEnv}
 */
export function relaunchEnv(cwd, env = process.env) {
  const names = envFileNames(join(cwd, ".env"));
  if (names.size === 0) return env;
  const fresh = { ...env };
  for (const name of names) delete fresh[name];
  return fresh;
}

/**
 * Start the replacement launcher. It inherits this process's stdio so its
 * output lands where ours did (the terminal or the log the stack was started
 * into), and runs detached so it survives our exit. Its environment is this
 * one's, minus what `.env` defines, so the file is read again.
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
    env: relaunchEnv(relaunch.cwd, env),
    stdio: "inherit",
    detached: process.platform !== "win32",
  });
  child.unref();
  return child;
}
