/**
 * The half of the usage ledger that nobody could read.
 *
 * `unusedFeatures` computed "which shipped features has nobody reached for"
 * from the day the trials landed, with six tests behind it and no caller — so
 * milestone 6's *"features with no recorded use after fourteen days are
 * surfaced for removal rather than accumulating"* had nothing doing the
 * surfacing.
 */

import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderWithProviders } from "../../../../test-utils";
import { UnusedFeatureList } from "#/components/features/feature-trials/unused-feature-list";
import { FEATURE_TRIALS } from "#/features/feature-trials";
import {
  clearFeatureTrials,
  useFeatureTrialStore,
} from "#/stores/feature-trial-store";
import {
  emptyFeatureTrialRecord,
  FEATURE_TRIAL_UNUSED_DAYS,
} from "#/types/feature-trial";
import { I18nKey } from "#/i18n/declaration";

const [TRIAL] = FEATURE_TRIALS;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Announce the trial this many days ago, with the given use count. */
function announced(daysAgo: number, useCount = 0) {
  useFeatureTrialStore.setState({
    records: {
      [TRIAL.id]: {
        ...emptyFeatureTrialRecord(TRIAL.id),
        announcedAt: new Date(Date.now() - daysAgo * DAY_MS).toISOString(),
        useCount,
        lastUsedAt: useCount > 0 ? new Date().toISOString() : null,
        rating: "up",
      },
    },
  });
}

describe("UnusedFeatureList", () => {
  beforeEach(() => clearFeatureTrials());
  afterEach(() => clearFeatureTrials());

  it("names a feature nobody has opened since it was announced", () => {
    // Arrange
    announced(FEATURE_TRIAL_UNUSED_DAYS + 8);

    // Act
    renderWithProviders(<UnusedFeatureList />);

    // Assert: the age, because "22 days and never opened" is the argument for
    // removing it and a date makes the reader do the subtraction.
    expect(screen.getByTestId("unused-feature")).toHaveAttribute(
      "data-age",
      String(FEATURE_TRIAL_UNUSED_DAYS + 8),
    );
    // The rating stays beside it, and is labelled rather than colour-only:
    // welcomed and then forgotten is not the same case as disliked, and a
    // reader using a screen reader needs the difference too.
    expect(screen.getByLabelText(I18nKey.FEATURE$RATE$UP)).toBeInTheDocument();
  });

  it("renders nothing while every feature is either used or still new", () => {
    // Arrange: one used, and the same trial while still inside its window.
    announced(FEATURE_TRIAL_UNUSED_DAYS + 8, 3);
    const { unmount } = renderWithProviders(<UnusedFeatureList />);
    expect(screen.queryByTestId("unused-features")).not.toBeInTheDocument();
    unmount();

    // Act
    announced(FEATURE_TRIAL_UNUSED_DAYS - 1);
    renderWithProviders(<UnusedFeatureList />);

    // Assert: a panel that says "everything is fine" on every visit teaches
    // the reader to stop looking at it — which is how the ledger would end up
    // unread for the second time.
    expect(screen.queryByTestId("unused-features")).not.toBeInTheDocument();
  });
});
