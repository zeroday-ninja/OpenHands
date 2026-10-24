/**
 * Which shipped features nobody reached for.
 *
 * The question this answers is not "what is popular" — it is "what did we
 * build that solved a problem nobody had". A feature announced two weeks ago
 * and never touched since is worth removing, and removing it is cheaper than
 * carrying it.
 *
 * Counted from the day it was *announced*, not the day it shipped: a feature
 * nobody was told about has not had its chance yet, and judging it unused
 * would blame the feature for a missing announcement.
 */

import {
  FEATURE_TRIAL_UNUSED_DAYS,
  type FeatureTrial,
  type FeatureTrialRecord,
} from "#/types/feature-trial";

export interface UnusedFeature {
  trial: FeatureTrial;
  /** Days since it was announced. */
  age: number;
  /** What the user said about it, when they said anything. */
  rating: "up" | "down" | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function unusedFeatures(
  trials: readonly FeatureTrial[],
  records: Record<string, FeatureTrialRecord>,
  now: Date = new Date(),
): UnusedFeature[] {
  const unused: UnusedFeature[] = [];
  trials.forEach((trial) => {
    const record = records[trial.id];
    if (!record?.announcedAt) return;
    if (record.useCount > 0) return;
    const announced = Date.parse(record.announcedAt);
    if (Number.isNaN(announced)) return;
    const age = Math.floor((now.getTime() - announced) / DAY_MS);
    if (age < FEATURE_TRIAL_UNUSED_DAYS) return;
    unused.push({ trial, age, rating: record.rating });
  });
  // Longest-ignored first: that is the one with the most evidence behind it.
  return unused.sort((left, right) => right.age - left.age);
}
