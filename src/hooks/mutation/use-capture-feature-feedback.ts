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
import { getRegisteredBackends } from "#/api/backend-registry/active-store";
import { eligibleForSync } from "#/api/soul-service/soul-service.api";
import type { FeatureTrial } from "#/types/feature-trial";
import { useSyncMemoryAcrossBackends } from "#/hooks/mutation/use-sync-memory-across-backends";
import { fileCorrectionInMemory } from "#/utils/soul/file-correction-in-memory";

export interface CaptureFeatureFeedbackInput {
  trial: FeatureTrial;
  rating: "up" | "down";
  comment: string | null;
}

export function useCaptureFeatureFeedback() {
  const spread = useSyncMemoryAcrossBackends();

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
      await fileCorrectionInMemory({
        lessonId: captured.lesson.id,
        scope: "surface",
        subject: trial.id,
        trigger,
        text,
      });
      // And on to the other machines, because the plan asks for memory
      // "synced across backends, eventually consistent" and the only thing
      // that synced it was a button in settings — so a correction given on
      // one machine reached the others when somebody remembered to press it.
      //
      // Here rather than on a timer or at startup: the moment memory actually
      // changed is the only moment there is anything to carry, so nothing is
      // sent on a machine nobody has corrected anything on. A single backend
      // would be syncing with itself, which is the condition the button hides
      // itself under too.
      if (eligibleForSync(getRegisteredBackends()).length > 1) {
        // Best effort, and never fatal: the correction is already filed and
        // recorded. `useSyncMemoryAcrossBackends` reports every backend it
        // could not reach, and its own surface in settings shows that.
        spread.mutate(undefined, {
          onError: (error) =>
            console.warn(
              "The correction was filed but could not be spread to the other backends:",
              error,
            ),
        });
      }
    },
    // The caller shows the failure. A rating the person believes they gave is
    // worse than no rating, so this must not be silent — and it must not be a
    // toast either, because the thing that needs correcting is on screen.
    meta: { disableToast: true },
  });
}
