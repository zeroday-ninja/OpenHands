/**
 * Features this app shipped itself that nobody has reached for.
 *
 * `unusedFeatures` has computed this since the trials landed and nothing
 * rendered it, so the one thing milestone 6 asks for — *"features with no
 * recorded use after fourteen days are surfaced for removal rather than
 * accumulating"* — was the half that never happened. A ledger nobody reads
 * accumulates exactly like no ledger at all.
 *
 * It sits beside the parked-work panel for the reason that panel gives for
 * sitting on the map: this is a decision waiting on the reader, and a decision
 * on another page is one they have to go looking for.
 *
 * Nothing renders until something has actually gone unused, by the same rule:
 * a panel that says "everything is fine" on every visit teaches the reader to
 * stop looking at it.
 *
 * It does not offer to remove anything. Removing a feature is a change to the
 * code, which is the agents' work and the user's call — this says which ones
 * have earned the question.
 */

import { useTranslation } from "react-i18next";
import { PackageOpen, ThumbsDown, ThumbsUp } from "lucide-react";
import { I18nKey } from "#/i18n/declaration";
import { FEATURE_TRIALS } from "#/features/feature-trials";
import { useFeatureTrialStore } from "#/stores/feature-trial-store";
import { unusedFeatures } from "#/utils/feature-trials/unused-features";
import type { FeatureTrial } from "#/types/feature-trial";

const ICON_SIZE = 14;

export interface UnusedFeatureListProps {
  /** Overridable so a caller can scope it; defaults to everything shipped. */
  trials?: readonly FeatureTrial[];
}

export function UnusedFeatureList({
  trials = FEATURE_TRIALS,
}: UnusedFeatureListProps) {
  const { t } = useTranslation("openhands");
  const records = useFeatureTrialStore((state) => state.records);
  const unused = unusedFeatures(trials, records);

  if (unused.length === 0) return null;

  return (
    <section
      data-testid="unused-features"
      data-count={unused.length}
      className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-base-secondary p-3"
    >
      <header className="flex items-baseline gap-2">
        <PackageOpen size={ICON_SIZE} aria-hidden className="text-muted" />
        <h3 className="text-sm font-medium text-contrast">
          {t(I18nKey.FEATURE$UNUSED$HEADING)}
        </h3>
        <p className="text-xs text-text-secondary">
          {t(I18nKey.FEATURE$UNUSED$SUBTITLE)}
        </p>
      </header>
      {unused.map(({ trial, age, rating }) => (
        <article
          key={trial.id}
          data-testid="unused-feature"
          data-trial-id={trial.id}
          data-age={age}
          className="flex items-baseline gap-2 text-xs"
        >
          <span className="font-medium text-contrast">{t(trial.titleKey)}</span>
          {/* The age, not the date: "22 days and never opened" is the
              argument for removing it, and a date makes the reader do the
              subtraction. */}
          <span className="text-text-secondary">
            {t(I18nKey.FEATURE$UNUSED$AGE, { days: age })}
          </span>
          {/* A rating is kept beside it because the two answer different
              questions: a thumbs-up on something never used since says the
              feature was welcome and then forgotten, which is not the same
              case as one nobody liked. */}
          {rating === "up" && (
            <ThumbsUp
              size={ICON_SIZE}
              aria-label={t(I18nKey.FEATURE$RATE$UP)}
              className="text-success"
            />
          )}
          {rating === "down" && (
            <ThumbsDown
              size={ICON_SIZE}
              aria-label={t(I18nKey.FEATURE$RATE$DOWN)}
              className="text-warning"
            />
          )}
        </article>
      ))}
    </section>
  );
}
