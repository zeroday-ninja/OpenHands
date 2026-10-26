import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildUpdateSteps,
  detectSelfUpdate,
  runSelfUpdate,
  spawnRelaunch,
  toControlInfo,
  envFileNames,
} from "../../scripts/self-update.mjs";

const tempDirs: string[] = [];

function tempRoot(...segments: string[]) {
  const base = mkdtempSync(path.join(tmpdir(), "canvas-self-update-"));
  tempDirs.push(base);
  const root = path.join(base, ...segments);
  mkdirSync(root, { recursive: true });
  return root;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

const launch = {
  argv: [
    "/usr/bin/node",
    "/x/scripts/dev-with-automation.mjs",
    "--port",
    "9000",
  ],
  execArgv: ["--env-file-if-exists=.env"],
  execPath: "/usr/bin/node",
  cwd: "/x",
  platform: "linux" as NodeJS.Platform,
};

describe("detectSelfUpdate", () => {
  it("updates a source checkout with git and relaunches the same command line", () => {
    const projectRoot = tempRoot("checkout");
    mkdirSync(path.join(projectRoot, ".git"));

    const detection = detectSelfUpdate({
      projectRoot,
      version: "1.2.3",
      ...launch,
    });

    expect(detection.self_update).toEqual({
      supported: true,
      method: "git-checkout",
      reason: null,
    });
    expect(detection.restart.supported).toBe(true);
    expect(detection.relaunch).toEqual({
      command: "/usr/bin/node",
      args: [
        "--env-file-if-exists=.env",
        "/x/scripts/dev-with-automation.mjs",
        "--port",
        "9000",
      ],
      cwd: "/x",
    });
    expect(
      buildUpdateSteps(detection, { projectRoot, platform: "linux" }).map(
        (s) => s.label,
      ),
    ).toEqual(["git pull", "npm ci"]);
  });

  it("updates a global npm install in place and relaunches the same bin", () => {
    const projectRoot = tempRoot(
      "lib",
      "node_modules",
      "@openhands",
      "agent-canvas",
    );

    const detection = detectSelfUpdate({
      projectRoot,
      version: "1.2.3",
      ...launch,
    });

    expect(detection.self_update.method).toBe("npm-global");
    const steps = buildUpdateSteps(detection, {
      projectRoot,
      platform: "linux",
    });
    expect(steps).toHaveLength(1);
    expect(steps[0].args).toEqual([
      "install",
      "-g",
      "--no-audit",
      "--no-fund",
      "--prefix",
      path.dirname(path.dirname(path.dirname(path.dirname(projectRoot)))),
      "@openhands/agent-canvas@latest",
    ]);
    expect(detection.relaunch?.command).toBe("/usr/bin/node");
  });

  it("relaunches an npx install through npm exec on the latest release, keeping the user's flags", () => {
    const projectRoot = tempRoot(
      ".npm",
      "_npx",
      "abc123",
      "node_modules",
      "@openhands",
      "agent-canvas",
    );

    const detection = detectSelfUpdate({
      projectRoot,
      version: "1.2.3",
      ...launch,
    });

    expect(detection.self_update.method).toBe("npx");
    expect(buildUpdateSteps(detection, { projectRoot })).toEqual([]);
    expect(detection.relaunch).toEqual({
      command: "npm",
      args: [
        "exec",
        "--yes",
        "--",
        "@openhands/agent-canvas@latest",
        "--port",
        "9000",
      ],
      cwd: "/x",
    });
  });

  it("offers nothing to a public or non-loopback stack, whose page holds no session key", () => {
    const projectRoot = tempRoot("checkout");
    mkdirSync(path.join(projectRoot, ".git"));

    for (const overrides of [{ isPublic: true }, { isLoopback: false }]) {
      const detection = detectSelfUpdate({
        projectRoot,
        version: "1.2.3",
        ...launch,
        ...overrides,
      });
      expect(detection.self_update).toEqual({
        supported: false,
        method: null,
        reason: "public",
      });
      expect(detection.restart.supported).toBe(false);
      expect(detection.relaunch).toBeNull();
    }
  });

  it("still offers a restart when the install method is unknown", () => {
    const projectRoot = tempRoot("somewhere", "else");

    const detection = detectSelfUpdate({
      projectRoot,
      version: "1.2.3",
      ...launch,
    });

    expect(detection.self_update).toEqual({
      supported: false,
      method: null,
      reason: "unknown-install",
    });
    expect(detection.restart.supported).toBe(true);
    expect(detection.relaunch).not.toBeNull();
    expect(toControlInfo(detection)).toMatchObject({
      version: "1.2.3",
      update_path: "/__agent-canvas/update",
      restart_path: "/__agent-canvas/restart",
      status_path: "/__agent-canvas/status",
    });
  });
});

/** A spawn double that scripts each command's exit code and output. */
function fakeSpawn(
  script: (command: string, args: string[]) => { code: number; out?: string },
) {
  const calls: string[][] = [];
  const spawnImpl = (command: string, args: string[]) => {
    calls.push([command, ...args]);
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      unref: () => void;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.unref = () => {};
    const { code, out } = script(command, args);
    setTimeout(() => {
      if (out) child.stdout.emit("data", Buffer.from(out));
      child.emit("exit", code);
    }, 0);
    return child;
  };
  return { spawnImpl, calls };
}

describe("runSelfUpdate", () => {
  const checkout = () => {
    const projectRoot = tempRoot("checkout");
    mkdirSync(path.join(projectRoot, ".git"));
    return projectRoot;
  };

  it("skips npm ci when git pull did not move HEAD", async () => {
    const projectRoot = checkout();
    const detection = detectSelfUpdate({
      projectRoot,
      version: "1",
      ...launch,
    });
    const { spawnImpl, calls } = fakeSpawn((_cmd, args) => {
      if (args[0] === "status") return { code: 0, out: "" };
      if (args[0] === "rev-parse")
        return { code: 0, out: args.includes("@{u}") ? "origin/x\n" : "abc\n" };
      return { code: 0, out: "Already up to date.\n" };
    });

    const result = await runSelfUpdate(detection, {
      projectRoot,
      spawnImpl,
      platform: "linux",
    });

    expect(result.ok).toBe(true);
    expect(calls.map((c) => c.slice(1).join(" "))).toEqual([
      "status --porcelain",
      "rev-parse HEAD",
      "rev-parse --abbrev-ref @{u}",
      "pull --ff-only",
      "rev-parse HEAD",
    ]);
  });

  it("reinstalls dependencies when the pull moved HEAD", async () => {
    const projectRoot = checkout();
    const detection = detectSelfUpdate({
      projectRoot,
      version: "1",
      ...launch,
    });
    let head = "abc";
    const { spawnImpl, calls } = fakeSpawn((_cmd, args) => {
      if (args[0] === "status") return { code: 0, out: "" };
      if (args[0] === "rev-parse")
        return {
          code: 0,
          out: args.includes("@{u}") ? "origin/x\n" : `${head}\n`,
        };
      if (args[0] === "pull") {
        head = "def";
        return { code: 0, out: "Updating abc..def\n" };
      }
      return { code: 0 };
    });

    const result = await runSelfUpdate(detection, {
      projectRoot,
      spawnImpl,
      platform: "linux",
    });

    expect(result.ok).toBe(true);
    expect(calls.at(-1)?.slice(1)).toEqual(["ci", "--no-audit", "--no-fund"]);
  });

  it("reports the failing step with its output and stops there", async () => {
    const projectRoot = checkout();
    const detection = detectSelfUpdate({
      projectRoot,
      version: "1",
      ...launch,
    });
    const { spawnImpl, calls } = fakeSpawn((_cmd, args) => {
      if (args[0] === "status") return { code: 0, out: "" };
      if (args[0] === "pull")
        return {
          code: 128,
          out: "fatal: Not possible to fast-forward, aborting.\n",
        };
      return { code: 0, out: "abc\n" };
    });

    const result = await runSelfUpdate(detection, {
      projectRoot,
      spawnImpl,
      platform: "linux",
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("git pull failed (exit 128)");
    expect(result.message).toContain("Not possible to fast-forward");
    expect(calls.some((c) => c[1] === "ci")).toBe(false);
  });

  it("merges the release tag when the checkout is older than the release the browser saw", async () => {
    const projectRoot = checkout();
    writeFileSync(
      path.join(projectRoot, "package.json"),
      JSON.stringify({ version: "1.27.1" }),
    );
    const detection = detectSelfUpdate({
      projectRoot,
      version: "1.27.1",
      ...launch,
    });
    let head = "abc";
    const { spawnImpl, calls } = fakeSpawn((_cmd, args) => {
      if (args[0] === "rev-parse")
        return {
          code: 0,
          out: args.includes("@{u}") ? "origin/main\n" : `${head}\n`,
        };
      if (args[0] === "merge") {
        head = "merged";
        writeFileSync(
          path.join(projectRoot, "package.json"),
          JSON.stringify({ version: "1.29.0" }),
        );
      }
      return { code: 0, out: "" };
    });

    const result = await runSelfUpdate(detection, {
      projectRoot,
      spawnImpl,
      platform: "linux",
      targetVersion: "1.29.0",
      upstreamRepo: "https://example.test/upstream.git",
    });

    expect(result.ok).toBe(true);
    const commands = calls.map((c) => c.slice(1).join(" "));
    expect(commands).toContain(
      "fetch --no-tags https://example.test/upstream.git refs/tags/v1.29.0",
    );
    expect(commands).toContain(
      "merge --no-ff -m Merge release v1.29.0 from https://example.test/upstream.git FETCH_HEAD",
    );
    expect(commands.at(-1)).toBe("ci --no-audit --no-fund");
    expect(commands.indexOf("pull --ff-only")).toBeLessThan(
      commands.indexOf(
        "merge --no-ff -m Merge release v1.29.0 from https://example.test/upstream.git FETCH_HEAD",
      ),
    );
  });

  it("skips the release merge when the pull already brought that version, and refuses a dirty checkout", async () => {
    const projectRoot = checkout();
    writeFileSync(
      path.join(projectRoot, "package.json"),
      JSON.stringify({ version: "1.29.0" }),
    );
    const detection = detectSelfUpdate({
      projectRoot,
      version: "1.29.0",
      ...launch,
    });
    const clean = fakeSpawn((_cmd, args) =>
      args[0] === "status"
        ? { code: 0, out: "" }
        : { code: 0, out: args[0] === "rev-parse" ? "abc\n" : "" },
    );
    const result = await runSelfUpdate(detection, {
      projectRoot,
      spawnImpl: clean.spawnImpl,
      platform: "linux",
      targetVersion: "1.29.0",
    });
    expect(result.ok).toBe(true);
    expect(clean.calls.some((c) => c[1] === "fetch" || c[1] === "merge")).toBe(
      false,
    );

    const dirty = fakeSpawn((_cmd, args) =>
      args[0] === "status"
        ? { code: 0, out: " M src/app.tsx\n" }
        : { code: 0, out: "abc\n" },
    );
    const refused = await runSelfUpdate(detection, {
      projectRoot,
      spawnImpl: dirty.spawnImpl,
      platform: "linux",
      targetVersion: "1.29.0",
    });
    expect(refused.ok).toBe(false);
    expect(refused.message).toContain("uncommitted changes");
    expect(dirty.calls.some((c) => c[1] === "pull")).toBe(false);
  });

  it("aborts a conflicting release merge and leaves the checkout as it was", async () => {
    const projectRoot = checkout();
    writeFileSync(
      path.join(projectRoot, "package.json"),
      JSON.stringify({ version: "1.27.1" }),
    );
    const detection = detectSelfUpdate({
      projectRoot,
      version: "1.27.1",
      ...launch,
    });
    const { spawnImpl, calls } = fakeSpawn((_cmd, args) => {
      if (args[0] === "merge" && args[1] !== "--abort")
        return {
          code: 1,
          out: "CONFLICT (content): Merge conflict in src/x.ts\n",
        };
      return { code: 0, out: args[0] === "rev-parse" ? "abc\n" : "" };
    });

    const result = await runSelfUpdate(detection, {
      projectRoot,
      spawnImpl,
      platform: "linux",
      targetVersion: "1.29.0",
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("merge release v1.29.0 failed");
    expect(result.message).toContain("CONFLICT");
    expect(calls.map((c) => c.slice(1).join(" "))).toContain("merge --abort");
    expect(calls.some((c) => c[1] === "ci")).toBe(false);
  });

  it("installs a global npm update into the prefix the running bin came from", () => {
    const projectRoot = tempRoot(
      "prefix",
      "lib",
      "node_modules",
      "@openhands",
      "agent-canvas",
    );
    const detection = detectSelfUpdate({
      projectRoot,
      version: "1.27.1",
      ...launch,
    });
    const [step] = buildUpdateSteps(detection, {
      projectRoot,
      platform: "linux",
    });
    expect(step.args).toEqual([
      "install",
      "-g",
      "--no-audit",
      "--no-fund",
      "--prefix",
      path.dirname(path.dirname(path.dirname(path.dirname(projectRoot)))),
      "@openhands/agent-canvas@latest",
    ]);
  });

  it("refuses when the detection does not support updating", async () => {
    const detection = detectSelfUpdate({
      projectRoot: tempRoot("x"),
      version: "1",
      ...launch,
    });
    const result = await runSelfUpdate(detection, {
      projectRoot: "/x",
      spawnImpl: fakeSpawn(() => ({ code: 0 })).spawnImpl,
    });
    expect(result).toEqual({
      ok: false,
      message: "Self-update is not available (unknown-install).",
    });
  });
});

describe("spawnRelaunch", () => {
  it("lets the relaunch read .env again instead of inheriting the old values", () => {
    // Arrange: the file was edited after this stack started, so the running
    // process still carries the old pin. Node's --env-file never overrides a
    // set variable, so the inherited value must go.
    const cwd = mkdtempSync(path.join(tmpdir(), "relaunch-env-"));
    writeFileSync(
      path.join(cwd, ".env"),
      [
        "# pins",
        "OH_CONVERSATION_IMAGE=openhands-local/agent-server:new",
        "export OH_AUTOMATION_LOCAL_PATH=/srv/automation",
        "",
      ].join("\n"),
    );
    const seen: unknown[] = [];
    const spawnImpl = (_command: string, _args: string[], options: unknown) => {
      seen.push(options);
      return { unref: () => undefined };
    };

    // Act
    spawnRelaunch(
      { command: "/usr/bin/node", args: ["a"], cwd },
      {
        spawnImpl,
        env: {
          OH_CONVERSATION_IMAGE: "openhands-local/agent-server:old",
          OH_AUTOMATION_LOCAL_PATH: "/old",
          PATH: "/usr/bin",
        },
      },
    );

    // Assert: the file's names are dropped, everything else is kept.
    expect((seen[0] as { env: Record<string, string> }).env).toEqual({
      PATH: "/usr/bin",
    });
    expect(envFileNames(path.join(cwd, "missing.env")).size).toBe(0);
  });

  it("starts the relaunch detached with inherited stdio and lets this process exit", () => {
    const seen: unknown[] = [];
    const spawnImpl = (command: string, args: string[], options: unknown) => {
      seen.push([command, args, options]);
      return { unref: () => seen.push("unref") };
    };

    spawnRelaunch(
      { command: "/usr/bin/node", args: ["a"], cwd: "/x" },
      { spawnImpl, env: { A: "1" } },
    );

    expect(seen[0]).toEqual([
      "/usr/bin/node",
      ["a"],
      {
        cwd: "/x",
        env: { A: "1" },
        stdio: "inherit",
        detached: process.platform !== "win32",
      },
    ]);
    expect(seen[1]).toBe("unref");
  });
});
