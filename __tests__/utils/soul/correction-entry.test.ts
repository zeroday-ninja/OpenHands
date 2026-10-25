/**
 * A correction, filed where a person can read it.
 *
 * The learn-a-lesson-once rule's third stage — injection into every cycle in
 * scope — was built. Its second, *"scope it, **and file it where it belongs**"*,
 * was not, so the exit it carries ("a correction given once is visible in the
 * document it belongs to") had nothing behind it: a correction lived in a
 * database row and in prompts nobody reads.
 */

import { describe, expect, it } from "vitest";
import {
  correctionEntry,
  correctionEntryId,
  withCorrection,
} from "#/utils/soul/correction-entry";

const AT = new Date("2026-10-25T11:22:33.456Z");

const CORRECTION = {
  lessonId: "9c96b4be-4c7b-47c3-accd-7f56d1a3bd12",
  scope: "surface",
  subject: "map-waiting-on-you",
  trigger: "thumbs_down",
  text: "The panel buries the rollback under the breaks list.",
  at: AT,
};

describe("filing a correction in MEMORY.md", () => {
  it("writes an entry the cross-backend merge can parse", () => {
    // The merge takes a union by entry id, which is what lets a correction
    // captured on one machine reach the others by the sync that already
    // exists. An entry without the heading and id comment is invisible to it.
    const entry = correctionEntry(CORRECTION);

    expect(entry).toMatch(
      /^## 2026-10-25T11:22:33Z — Correction \(surface: map-waiting-on-you\)$/m,
    );
    expect(entry).toContain(
      `<!-- id: ${correctionEntryId(CORRECTION.lessonId)} -->`,
    );
    // Verbatim: paraphrasing a correction is how it comes back as one the
    // user has to give again.
    expect(entry).toContain(CORRECTION.text);
    expect(entry).toContain("Captured from thumbs down.");
  });

  it("appends without disturbing what the user wrote", () => {
    // MEMORY.md is theirs. A writer that reordered or reformatted it would be
    // rewriting the document, which is the one thing SOUL.md's own text
    // forbids and which this document inherits by being in the same set.
    const existing =
      "## 2026-10-01T00:00:00Z — Something earlier\n<!-- id: mem-abc -->\n\nTheir own words.\n";

    const after = withCorrection(existing, CORRECTION);

    expect(after.startsWith(existing.trimEnd())).toBe(true);
    expect(after).toContain(CORRECTION.text);
  });

  it("writing the same correction twice writes it once", () => {
    // Capture retries, two tabs, and a sync bringing the entry back are all
    // ordinary. The entry id is derived from the lesson's, so none of them
    // can double it.
    const once = withCorrection("", CORRECTION);

    expect(withCorrection(once, CORRECTION)).toBe(once);
  });

  it("starts the document when there is nothing there yet", () => {
    // MEMORY.md does not exist until something is learned, so the first
    // correction must not leave a leading blank line in a file it created.
    const first = withCorrection("", CORRECTION);

    expect(first.startsWith("## ")).toBe(true);
  });

  it("names the scope alone when the correction named no subject", () => {
    const everywhere = correctionEntry({
      ...CORRECTION,
      scope: "user",
      subject: null,
    });

    expect(everywhere).toContain("— Correction (user)");
  });
});
