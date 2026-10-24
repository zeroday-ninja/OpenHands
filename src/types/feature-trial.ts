/**
 * Features this app shipped on its own, and what happened to them.
 *
 * A cycle that ships something a person can see has to introduce it and ask
 * how it went, or the only way to find out is for the person to notice. So
 * every autonomously introduced surface is declared here, and the declaration
 * is what the announcement, the walkthrough and the rating are generated from
 * — a feature cannot ship with one and not the others, because there is one
 * entry rather than three.
 */

/** What kind of thing was introduced. */
export type FeatureTrialKind = "widget" | "panel" | "plugin" | "skill" | "app";

/** One step of the walkthrough. */
export interface FeatureTrialStep {
  /** Heading for this step. */
  titleKey: string;
  /** What this step explains. */
  bodyKey: string;
  /**
   * The element this step is about, as a `data-testid`. The walkthrough
   * scrolls to it and outlines it, which is what makes a walkthrough point at
   * something rather than describe it.
   */
  testId?: string;
}

/** One autonomously introduced feature. */
export interface FeatureTrial {
  /** Stable id. The ledger is keyed by it, so it outlives a renamed title. */
  id: string;
  kind: FeatureTrialKind;
  /** When the cycle that shipped it landed, as an ISO date. */
  shippedOn: string;
  titleKey: string;
  summaryKey: string;
  /** Where it lives, so the announcement can take the reader to it. */
  route: string;
  /**
   * The walkthrough. Never empty: a feature announced with nothing to show is
   * an announcement the reader cannot act on.
   */
  steps: FeatureTrialStep[];
}

/** What this installation has done with one shipped feature. */
export interface FeatureTrialRecord {
  id: string;
  /** When the announcement was shown and dismissed. */
  announcedAt: string | null;
  firstUsedAt: string | null;
  lastUsedAt: string | null;
  useCount: number;
  /** `null` until rated. A rating never waits for a comment. */
  rating: "up" | "down" | null;
  ratedAt: string | null;
  comment: string | null;
}

/**
 * How long a shipped feature may go unused before it is worth revisiting.
 *
 * Fourteen days rather than a number of sessions: a feature nobody reached for
 * in two weeks of ordinary work is a feature that solved a problem nobody had,
 * and counting sessions would make a quiet fortnight look like evidence of use.
 */
export const FEATURE_TRIAL_UNUSED_DAYS = 14;

export function emptyFeatureTrialRecord(id: string): FeatureTrialRecord {
  return {
    id,
    announcedAt: null,
    firstUsedAt: null,
    lastUsedAt: null,
    useCount: 0,
    rating: null,
    ratedAt: null,
    comment: null,
  };
}
