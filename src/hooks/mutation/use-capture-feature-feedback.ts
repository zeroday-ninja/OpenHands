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
import type { FeatureTrial } from "#/types/feature-trial";

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
      await AutomationService.captureLesson({
        scope: "surface",
        subject: trial.id,
        trigger: rating === "down" ? "thumbs_down" : "comment",
        text,
        why: `Rated ${rating} on ${trial.route} after it shipped on ${trial.shippedOn}.`,
        source: { feature_id: trial.id, route: trial.route, rating },
      });
    },
    // The caller shows the failure. A rating the person believes they gave is
    // worse than no rating, so this must not be silent — and it must not be a
    // toast either, because the thing that needs correcting is on screen.
    meta: { disableToast: true },
  });
}
