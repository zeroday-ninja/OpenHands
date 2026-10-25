/**
 * A correction the user actually made, written into the document that owns it.
 *
 * The learn-a-lesson-once rule has four stages, and the third — injection into
 * every cycle in scope — was the one that got built: a captured lesson reaches
 * the prompt whether or not anybody reads a file. What was missing is its
 * second stage, *"scope it, **and file it where it belongs**"*, and the exit
 * that rests on it: "a correction given once is **visible in the document it
 * belongs to**". Until now a correction was visible only in a database row and
 * in prompts nobody reads.
 *
 * **MEMORY.md, not SOUL.md.** The user's own SOUL.md says it in as many words:
 * *"He edits this file. You may propose additions to it, never rewrite it."*
 * So a correction cannot be written there. MEMORY.md is the document whose
 * whole shape fits: append-only notable events, titled "What has already been
 * learned" in the load order, carrying an id and a timestamp per entry — the
 * same entries the cross-backend merge takes the union of, so a correction
 * captured on one machine reaches the others by the sync that already exists.
 *
 * **Idempotent on the lesson id.** Capture can be retried, two tabs can be
 * open, and a sync can bring the same entry back. The entry id is derived from
 * the lesson's, so writing it twice is writing it once.
 */

/** The id a correction's memory entry carries, derived from the lesson's. */
export function correctionEntryId(lessonId: string): string {
  return `lesson-${lessonId}`;
}

export interface CorrectionEntryInput {
  lessonId: string;
  /** `user`, `project`, `runtime` or `surface`. */
  scope: string;
  /** The repository, runtime or surface it applies to, when it named one. */
  subject: string | null;
  /** What produced it — a thumbs-down, a parked answer, an instruction. */
  trigger: string;
  /** The user's words. Never paraphrased: that is the point of the record. */
  text: string;
  /** When it was given. */
  at: Date;
}

/**
 * One MEMORY.md entry, in the format the merge parses.
 *
 * The heading is `## <timestamp> — <title>` with an `<!-- id: … -->` comment
 * under it, which is what makes a union by id possible rather than a
 * three-way merge of prose.
 */
export function correctionEntry(input: CorrectionEntryInput): string {
  const scope = input.subject
    ? `${input.scope}: ${input.subject}`
    : input.scope;
  // The title says what kind of thing this is and what it is about, because a
  // log read months later is scanned by heading before it is read.
  const title = `Correction (${scope})`;
  const body = [
    input.text.trim(),
    "",
    `Captured from ${input.trigger.replaceAll("_", " ")}.`,
  ].join("\n");
  return [
    `## ${input.at.toISOString().replace(/\.\d{3}Z$/, "Z")} — ${title}`,
    `<!-- id: ${correctionEntryId(input.lessonId)} -->`,
    "",
    body,
    "",
  ].join("\n");
}

/**
 * `document` with the correction appended, or unchanged if it is already there.
 *
 * Appended rather than merged in place: the log is ordered by timestamp when it
 * is read, so the writer does not have to find the right position — and a
 * writer that rearranged the user's file would be rewriting it.
 */
export function withCorrection(
  document: string,
  input: CorrectionEntryInput,
): string {
  if (document.includes(`<!-- id: ${correctionEntryId(input.lessonId)} -->`)) {
    return document;
  }
  const existing = document.trimEnd();
  const entry = correctionEntry(input);
  return existing ? `${existing}\n\n${entry}` : entry;
}
