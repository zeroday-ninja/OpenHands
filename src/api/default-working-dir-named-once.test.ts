/**
 * The default working directory is named in one place.
 *
 * `AGENTS.md` has said so for a while — *"Default working-directory behavior
 * must reuse `DEFAULT_WORKING_DIR` from `src/api/agent-server-config.ts`
 * rather than hardcoding `/workspace/project`"* — and nothing checked it, so
 * two copies of the literal had gone into the Cloud branch of
 * `readConversationFile`. They were right only for as long as nobody changed
 * the one that matters.
 *
 * This is that correction as a check, which is the stage that actually ends
 * repetition: a reader who skims `AGENTS.md` still fails here.
 *
 * Comments and test fixtures are left alone. The rule is about *behaviour*
 * reading the constant; prose explaining what the constant resolves to is how
 * the explanation stays readable, and a fixture naming a working directory is
 * naming its own input.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const SRC_ROOT = join(process.cwd(), "src");

/** Where the constant itself lives, and is therefore allowed to be written. */
const DEFINITION = "api/agent-server-config.ts";

/**
 * The literal, in the forms a working directory is written in.
 *
 * Both the absolute and relative spellings: the agent server takes a relative
 * dir and resolves it against the sandbox root, so `workspace/project` on its
 * own is the same hardcoding with one character removed.
 */
const HARDCODED = /(^|[^a-zA-Z0-9_/])\/?workspace\/project(?![a-zA-Z0-9_-])/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    const relPath = relative(SRC_ROOT, fullPath).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      // Mocks and generated types describe a server's own fixed paths rather
      // than deciding this app's working directory.
      return entry.name === "mocks" || entry.name === "agent-server"
        ? []
        : sourceFiles(fullPath);
    }
    if (!/\.tsx?$/.test(entry.name)) return [];
    if (/\.test\.tsx?$/.test(entry.name)) return [];
    if (relPath === DEFINITION) return [];
    return [relPath];
  });
}

/** `source` with comments removed, so prose about the path does not count. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("the default working directory is named once", () => {
  it("is never written out in code that decides a working directory", () => {
    // Arrange / Act
    const offenders = sourceFiles(SRC_ROOT).filter((relPath) =>
      HARDCODED.test(
        withoutComments(readFileSync(join(SRC_ROOT, relPath), "utf8")),
      ),
    );

    // Assert
    expect(offenders).toEqual([]);
  });

  it("catches the spelling that was actually committed", () => {
    // The guard is worth only as much as the case it would have caught: the
    // Cloud branch built PLAN.md's path from the literal twice.
    const committed = `const path = requirePathInsideDirectory(
        filePath ?? "/workspace/project/.agents_tmp/PLAN.md",
        "/workspace/project",
      );`;

    expect(HARDCODED.test(withoutComments(committed))).toBe(true);
    // And the relative spelling, which resolves to the same directory.
    expect(HARDCODED.test('workingDir: "workspace/project"')).toBe(true);
    // Not a different directory that merely starts the same way.
    expect(HARDCODED.test('"/workspace/projects-archive"')).toBe(false);
  });
});
