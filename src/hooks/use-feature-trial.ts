/**
 * Record that a feature the app shipped itself was actually reached for.
 *
 * Called by the feature, once per use, from wherever "used" genuinely means
 * used — a panel that rendered is not a panel anybody looked at, so mounting
 * is the wrong trigger and an interaction is the right one.
 *
 * Local only. The existing analytics are consent-gated and point at
 * OpenHands' own project, so the loop that shipped a feature cannot read back
 * whether anyone used it.
 */

import React from "react";
import { useFeatureTrialStore } from "#/stores/feature-trial-store";

export function useFeatureTrial(featureId: string) {
  const markUsed = useFeatureTrialStore((state) => state.markUsed);
  return React.useMemo(
    () => ({ markUsed: () => markUsed(featureId) }),
    [featureId, markUsed],
  );
}
