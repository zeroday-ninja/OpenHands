/**
 * Send a rating on an autonomously introduced feature to the agents.
 *
 * A thumbs-down is a correction, not a vote: it is captured under the
 * learn-a-lesson-once rule, scoped to the surface it was about, so it reaches
 * the next cycle without the user having to accept a proposal first.
 *
 * A thumbs-up is sent too, with its own trigger. "This was useful" is as much
 * a correction as "this was not" — the next cycle needs to know which of its
 * own guesses landed, or it has only failures to learn from.
 */

import { useMutation } from "@tanstack/react-query";
import AutomationService from "#/api/automation-service/automation-service.api";
import SoulService, {
  isSoulUnsupportedError,
  MEMORY_DOCUMENT_NAME,
} from "#/api/soul-service/soul-service.api";
import type { FeatureTrial } from "#/types/feature-trial";
import { withCorrection } from "#/utils/soul/correction-entry";

export interface CaptureFeatureFeedbackInput {
  trial: FeatureTrial;
  rating: "up" | "down";
  comment: string | null;
}

export function useCaptureFeatureFeedback() {
  return useMutation<void, Error, CaptureFeatureFeedbackInput>({
    mutationFn: async ({ trial, rating, comment }) => {
      // The feature's own words, not a template: the register's summary is
      // what the user was shown, so it is what the correction is about.
      const verdict = rating === "up" ? "landed" : "did not land";
      const text = comment
        ? comment
        : `The ${trial.kind} "${trial.id}" ${verdict} for me.`;
      const trigger = rating === "down" ? "thumbs_down" : "comment";
      const captured = await AutomationService.captureLesson({
        scope: "surface",
        subject: trial.id,
        trigger,
        text,
        why: `Rated ${rating} on ${trial.route} after it shipped on ${trial.shippedOn}.`,
        source: { feature_id: trial.id, route: trial.route, rating },
      });
      // And into the document that owns it, so the correction is somewhere a
      // person can read it rather than only in a row and in prompts. The rule
      // asks for both: injection is what guarantees a cycle sees it, the
      // document is what makes the record readable and complete.
      await recordInMemory(captured.lesson.id, trial.id, trigger, text);
    },
    // The caller shows the failure. A rating the person believes they gave is
    // worse than no rating, so this must not be silent — and it must not be a
    // toast either, because the thing that needs correcting is on screen.
    meta: { disableToast: true },
  });
}

/**
 * Append the correction to MEMORY.md, best effort and never silently.
 *
 * Best effort because the correction is already captured by the time this
 * runs: failing the whole mutation here would tell the user their rating did
 * not land when it did. Not silent, because a document that quietly missed an
 * entry is the `out_of_scope` failure this pipeline exists to diagnose — so
 * the reason is logged, and a backend too old to have an identity set is told
 * apart from one that refused.
 */
async function recordInMemory(
  lessonId: string,
  subject: string,
  trigger: string,
  text: string,
): Promise<void> {
  try {
    const before = await SoulService.getIdentityDocument(MEMORY_DOCUMENT_NAME);
    const after = withCorrection(before.content ?? "", {
      lessonId,
      scope: "surface",
      subject,
      trigger,
      text,
      at: new Date(),
    });
    if (after === (before.content ?? "")) return;
    await SoulService.saveIdentityDocument(MEMORY_DOCUMENT_NAME, after);
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
