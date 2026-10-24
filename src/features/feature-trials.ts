/**
 * The register of features this app shipped on its own.
 *
 * Committed rather than fetched, for two reasons. The announcement text has to
 * be translated, which is a build-time concern; and a feature that could
 * declare itself at runtime could ship without an announcement, which is the
 * one thing the gate here forbids.
 *
 * `__tests__/features/feature-trials.test.ts` holds the entries to that: every
 * one needs a title, a summary, a route and at least one walkthrough step, and
 * every key it names must exist in all locales.
 */

import { I18nKey } from "#/i18n/declaration";
import type { FeatureTrial } from "#/types/feature-trial";

export const FEATURE_TRIALS: readonly FeatureTrial[] = [
  {
    id: "map-waiting-on-you",
    kind: "panel",
    shippedOn: "2026-10-24",
    titleKey: I18nKey.FEATURE$WAITING$TITLE,
    summaryKey: I18nKey.FEATURE$WAITING$SUMMARY,
    route: "/map",
    steps: [
      {
        titleKey: I18nKey.FEATURE$WAITING$STEP1_TITLE,
        bodyKey: I18nKey.FEATURE$WAITING$STEP1_BODY,
        testId: "project-map-waiting",
      },
      {
        titleKey: I18nKey.FEATURE$WAITING$STEP2_TITLE,
        bodyKey: I18nKey.FEATURE$WAITING$STEP2_BODY,
        testId: "project-map-waiting-reason",
      },
    ],
  },
];

export function findFeatureTrial(id: string): FeatureTrial | null {
  return FEATURE_TRIALS.find((trial) => trial.id === id) ?? null;
}

/**
 * The trials a route may announce.
 *
 * A route announces its own features, because a walkthrough that points at an
 * element can only do so where that element is. A feature whose route nothing
 * renders is caught by the register's own test rather than by going unseen.
 */
export function featureTrialsOn(route: string): readonly FeatureTrial[] {
  return FEATURE_TRIALS.filter((trial) => trial.route === route);
}
