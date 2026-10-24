/**
 * A unified diff from a before and an after.
 *
 * The agent server answers `/api/git/diff` with the two versions of a file,
 * not with a diff — the web client builds its own side-by-side view from them.
 * A terminal wants the unified form, so this computes it.
 *
 * Hand-rolled, like the rest of this: a diff library would be a new pinned
 * dependency under the seven-day age rule, and the Myers-style LCS below is
 * well-understood and about forty lines. It is the plain dynamic-programming
 * LCS rather than the linear-space variant, bounded by `MAX_LINES` — a file
 * large enough to matter there is a file nobody reads as a diff in a terminal.
 */

/**
 * Largest file pair this will diff line-by-line.
 *
 * Past it the table is O(n·m) in memory and the answer is unreadable anyway,
 * so it says so rather than either hanging or silently truncating.
 */
export const MAX_LINES = 4000;

/** Lines of context either side of a change. */
export const CONTEXT = 3;

/**
 * The longest common subsequence of two line arrays, as a list of operations.
 *
 * @returns {{ op: " " | "-" | "+", text: string }[]}
 */
export function diffLines(before, after) {
  const n = before.length;
  const m = after.length;
  // Build the LCS table. Row-major, one extra row and column for the empty
  // prefixes, which is what makes the walk below need no special cases.
  const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i][j] =
        before[i] === after[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const operations = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      operations.push({ op: " ", text: before[i] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      operations.push({ op: "-", text: before[i] });
      i += 1;
    } else {
      operations.push({ op: "+", text: after[j] });
      j += 1;
    }
  }
  while (i < n) {
    operations.push({ op: "-", text: before[i] });
    i += 1;
  }
  while (j < m) {
    operations.push({ op: "+", text: after[j] });
    j += 1;
  }
  return operations;
}

/**
 * One file's change, as the lines of a unified diff.
 *
 * Unchanged runs longer than twice the context collapse to a hunk header, the
 * way `git diff` does — a diff that prints the whole file to show three
 * changed lines is a diff nobody reads.
 *
 * @param {string} path
 * @param {string} before
 * @param {string} after
 * @returns {string[]}
 */
export function unifiedDiff(path, before, after) {
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);

  if (beforeLines.length + afterLines.length > MAX_LINES * 2) {
    return [
      `diff --git a/${path} b/${path}`,
      `[too large to diff here: ${beforeLines.length} → ${afterLines.length} lines]`,
    ];
  }

  const operations = diffLines(beforeLines, afterLines);
  if (operations.every((entry) => entry.op === " ")) return [];

  const lines = [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
  ];

  // Walk the operations, emitting hunks. `keep` is the run of context since
  // the last change; a run longer than 2×CONTEXT means the hunks are separate.
  let hunk = [];
  let keep = [];
  let beforeAt = 1;
  let afterAt = 1;
  let hunkBefore = 1;
  let hunkAfter = 1;

  const flush = () => {
    if (hunk.length === 0) return;
    const beforeCount = hunk.filter((line) => line[0] !== "+").length;
    const afterCount = hunk.filter((line) => line[0] !== "-").length;
    lines.push(
      `@@ -${hunkBefore},${beforeCount} +${hunkAfter},${afterCount} @@`,
      ...hunk,
    );
    hunk = [];
  };

  operations.forEach((entry) => {
    if (entry.op === " ") {
      keep.push(` ${entry.text}`);
      beforeAt += 1;
      afterAt += 1;
      if (hunk.length > 0 && keep.length === CONTEXT) {
        hunk.push(...keep);
        keep = [];
        flush();
      }
      if (keep.length > CONTEXT) keep.shift();
      return;
    }
    if (hunk.length === 0) {
      // Opening a hunk: the context already collected becomes its head, and
      // the line numbers start that many lines back.
      hunkBefore = Math.max(1, beforeAt - keep.length);
      hunkAfter = Math.max(1, afterAt - keep.length);
      hunk.push(...keep);
      keep = [];
    }
    hunk.push(`${entry.op}${entry.text}`);
    if (entry.op === "-") beforeAt += 1;
    else afterAt += 1;
  });
  if (hunk.length > 0) {
    hunk.push(...keep.slice(0, CONTEXT));
    flush();
  }
  return lines;
}

function splitLines(text) {
  if (typeof text !== "string" || text === "") return [];
  // A trailing newline is a line terminator, not an empty last line; keeping
  // it would show every file as having one blank line changed.
  const withoutTrailing = text.endsWith("\n") ? text.slice(0, -1) : text;
  return withoutTrailing.split("\n");
}
