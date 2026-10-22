/**
 * Writing a learned preference into the user's SOUL.md.
 *
 * An improvement-program cycle may propose something about how the user wants
 * to be worked for, but is deliberately given no way to edit SOUL.md itself:
 * the document that tells every future run what the user wants is not
 * something a run may rewrite. Accepting a proposal is therefore only ever an
 * **append** — everything already in the document keeps its wording, its
 * order and its spacing, and the user's own sections are never touched.
 */

/** The section accepted proposals are collected under. */
export const SOUL_LEARNED_PREFERENCES_HEADING = "## Learned preferences";

/** Any heading level, so a user who re-nested the section keeps one of it. */
const LEARNED_PREFERENCES_HEADING = /^#{1,6}\s+learned preferences\s*$/i;
const ANY_HEADING = /^#{1,6}\s+\S/;
const FENCE = /^\s*(```|~~~)/;

/**
 * Markdown-level structure of each line: its heading level, or null for
 * anything that is not a heading. Fenced blocks are excluded so a shell
 * comment inside an example (`# install deps`) is not read as a heading.
 */
function headingLines(lines: string[]): (string | null)[] {
  let inFence = false;
  return lines.map((line) => {
    if (FENCE.test(line)) {
      inFence = !inFence;
      return null;
    }
    if (inFence || !ANY_HEADING.test(line)) return null;
    return line;
  });
}

/**
 * Compare on collapsed whitespace: a proposal is written into the document as
 * a single bullet, so a two-line proposal and the one line it became are the
 * same preference and must not be offered to the user twice.
 */
function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** The user's own calendar day, formatted locale-independently. */
function isoDate(now: Date): string {
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Whether this preference is already stated in SOUL.md.
 *
 * The backend has no "accepted" flag on a proposal and must not grow one, so
 * the document itself is the state: what it already says is what the user
 * already accepted, on every device and after every reload.
 */
export function soulStatesLearnedPreference(
  soulContent: string,
  text: string,
): boolean {
  const preference = collapseWhitespace(text);
  if (!preference) return false;
  return collapseWhitespace(soulContent).includes(preference);
}

/**
 * SOUL.md with this preference appended as a dated bullet under
 * `## Learned preferences`, creating that section at the end of the document
 * when it has none. Returns the whole document, because `PUT /api/soul`
 * replaces it.
 */
export function appendLearnedPreference(
  soulContent: string,
  text: string,
  now: Date = new Date(),
): string {
  const bullet = `- ${isoDate(now)}: ${collapseWhitespace(text)}`;
  const lines = soulContent.split("\n");
  const headings = headingLines(lines);
  const headingIndex = headings.findIndex(
    (line) => line !== null && LEARNED_PREFERENCES_HEADING.test(line),
  );

  if (headingIndex === -1) {
    const body = soulContent.replace(/\s+$/, "");
    const separator = body ? `${body}\n\n` : "";
    return `${separator}${SOUL_LEARNED_PREFERENCES_HEADING}\n\n${bullet}\n`;
  }

  // The end of the section, not the end of the file: the user may well keep
  // their own sections after it, and a bullet appended under one of those
  // would read as a preference about something else.
  const nextHeading = headings.findIndex(
    (line, index) => index > headingIndex && line !== null,
  );
  const sectionEnd = nextHeading === -1 ? lines.length : nextHeading;

  // Blank lines before the next heading belong to the document's spacing, so
  // the bullet goes above them rather than replacing them.
  let insertAt = sectionEnd;
  while (insertAt > headingIndex + 1 && lines[insertAt - 1].trim() === "") {
    insertAt -= 1;
  }

  const before = lines.slice(0, insertAt);
  // The first bullet in an otherwise empty section still needs the blank line
  // that separates a heading from its body.
  if (insertAt === headingIndex + 1) before.push("");
  const next = [...before, bullet, ...lines.slice(insertAt)].join("\n");
  return next.endsWith("\n") ? next : `${next}\n`;
}
