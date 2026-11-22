/**
 * Append a correction to MEMORY.md, best effort and never silently.
 *
 * Best effort because the correction is already captured by the time this
 * runs: failing the caller here would tell the user their correction did not
 * land when it did. Not silent, because a document that quietly missed an
 * entry is the `out_of_scope` failure the learning pipeline exists to
 * diagnose — so the reason is logged, and a backend too old to have an
 * identity set is told apart from one that refused.
 *
 * Through the merge, not a read and a write: two corrections filed close
 * together must not drop each other, and the server owns the union.
 */

import SoulService, {
  isSoulUnsupportedError,
} from "#/api/soul-service/soul-service.api";
import { correctionEntry } from "#/utils/soul/correction-entry";

export async function fileCorrectionInMemory(input: {
  lessonId: string;
  scope: string;
  subject: string | null;
  trigger: string;
  text: string;
}): Promise<void> {
  try {
    await SoulService.mergeMemory([
      correctionEntry({ ...input, at: new Date() }),
    ]);
  } catch (error) {
    if (isSoulUnsupportedError(error)) {
      // An older agent server has no identity set to file it in. The lesson
      // still reaches every cycle; only the readable copy is missing.
      console.warn(
        "The correction was captured but this backend has no identity set to file it in.",
      );
      return;
    }
    console.warn("The correction was captured but could not be filed:", error);
  }
}
