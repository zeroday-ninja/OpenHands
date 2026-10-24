import { describe, expect, it } from "vitest";
import { unusedFeatures } from "#/utils/feature-trials/unused-features";
import {
  emptyFeatureTrialRecord,
  FEATURE_TRIAL_UNUSED_DAYS,
  type FeatureTrial,
  type FeatureTrialRecord,
} from "#/types/feature-trial";

const NOW = new Date("2026-11-10T12:00:00Z");

const TRIAL: FeatureTrial = {
  id: "a-panel",
  kind: "panel",
  shippedOn: "2026-10-01",
  titleKey: "T",
  summaryKey: "S",
  route: "/map",
  steps: [{ titleKey: "ST", bodyKey: "SB" }],
};

function records(overrides: Partial<FeatureTrialRecord>) {
  return {
    [TRIAL.id]: { ...emptyFeatureTrialRecord(TRIAL.id), ...overrides },
  };
}

function daysBefore(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe("unusedFeatures", () => {
  it("surfaces a feature announced long ago and never touched", () => {
    const found = unusedFeatures(
      [TRIAL],
      records({ announcedAt: daysBefore(FEATURE_TRIAL_UNUSED_DAYS + 1) }),
      NOW,
    );

    expect(found).toHaveLength(1);
    expect(found[0].age).toBe(FEATURE_TRIAL_UNUSED_DAYS + 1);
  });

  it("leaves a feature that was used alone, however old", () => {
    const found = unusedFeatures(
      [TRIAL],
      records({ announcedAt: daysBefore(400), useCount: 1 }),
      NOW,
    );

    expect(found).toEqual([]);
  });

  it("gives a feature the full window before judging it", () => {
    const found = unusedFeatures(
      [TRIAL],
      records({ announcedAt: daysBefore(FEATURE_TRIAL_UNUSED_DAYS - 1) }),
      NOW,
    );

    expect(found).toEqual([]);
  });

  it("does not judge a feature nobody was told about", () => {
    // Counting from the ship date would blame the feature for a missing
    // announcement.
    const found = unusedFeatures([TRIAL], records({ announcedAt: null }), NOW);

    expect(found).toEqual([]);
  });

  it("ignores a stored date it cannot read", () => {
    // The ledger is user-writable storage. A NaN age would compare false
    // against the window and silently exclude the feature either way, so it
    // is excluded deliberately instead.
    const found = unusedFeatures(
      [TRIAL],
      records({ announcedAt: "not a date" }),
      NOW,
    );

    expect(found).toEqual([]);
  });

  it("puts the longest-ignored first", () => {
    const other: FeatureTrial = { ...TRIAL, id: "another-panel" };
    const found = unusedFeatures(
      [TRIAL, other],
      {
        [TRIAL.id]: {
          ...emptyFeatureTrialRecord(TRIAL.id),
          announcedAt: daysBefore(20),
        },
        [other.id]: {
          ...emptyFeatureTrialRecord(other.id),
          announcedAt: daysBefore(60),
        },
      },
      NOW,
    );

    expect(found.map((entry) => entry.trial.id)).toEqual([
      "another-panel",
      "a-panel",
    ]);
  });
});
