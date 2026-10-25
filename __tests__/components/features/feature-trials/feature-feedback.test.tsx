/**
 * Asking after the feature has been used, which is when there is an answer.
 *
 * The rating lived on the announcement's last step and nowhere else, so the
 * one moment a person could say how a feature went was the moment they were
 * first told about it. Once the walkthrough was done the announcement never
 * came back, and the affordance went with it.
 */

import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { renderWithProviders } from "../../../../test-utils";
import { FeatureFeedback } from "#/components/features/feature-trials/feature-feedback";
import {
  clearFeatureTrials,
  useFeatureTrialStore,
} from "#/stores/feature-trial-store";
import type { FeatureTrial } from "#/types/feature-trial";

const TRIAL: FeatureTrial = {
  id: "map-waiting-on-you",
  kind: "panel",
  shippedOn: "2026-10-24",
  titleKey: "FEATURE$WAITING$TITLE",
  summaryKey: "FEATURE$WAITING$SUMMARY",
  route: "/map",
  steps: [{ titleKey: "FEATURE$WAITING$STEP1_TITLE", bodyKey: "x" }],
};

describe("asking how a shipped feature went", () => {
  beforeEach(() => {
    clearFeatureTrials();
  });

  it("asks once the feature has been announced and used", () => {
    const store = useFeatureTrialStore.getState();
    store.markAnnounced(TRIAL.id);
    store.markUsed(TRIAL.id);

    renderWithProviders(<FeatureFeedback trials={[TRIAL]} />);

    expect(screen.getByTestId("feature-feedback")).toBeInTheDocument();
    expect(screen.getByTestId("feature-rating-up")).toBeInTheDocument();
  });

  it("does not ask about a feature nobody has used yet", () => {
    // The announcement is where the first ask lives, and a feature nobody has
    // touched has no answer to give. That case belongs to the unused-feature
    // list, which surfaces it for removal rather than for an opinion.
    useFeatureTrialStore.getState().markAnnounced(TRIAL.id);

    renderWithProviders(<FeatureFeedback trials={[TRIAL]} />);

    expect(screen.queryByTestId("feature-feedback")).not.toBeInTheDocument();
  });

  it("stops asking once it has been answered", () => {
    const store = useFeatureTrialStore.getState();
    store.markAnnounced(TRIAL.id);
    store.markUsed(TRIAL.id);
    store.rate(TRIAL.id, "up");

    renderWithProviders(<FeatureFeedback trials={[TRIAL]} />);

    expect(screen.queryByTestId("feature-feedback")).not.toBeInTheDocument();
  });

  it("asks nothing before the announcement has been seen", () => {
    // Two asks on screen at once is noise, and the announcement's own last
    // step already carries a rating.
    useFeatureTrialStore.getState().markUsed(TRIAL.id);

    renderWithProviders(<FeatureFeedback trials={[TRIAL]} />);

    expect(screen.queryByTestId("feature-feedback")).not.toBeInTheDocument();
  });
});
