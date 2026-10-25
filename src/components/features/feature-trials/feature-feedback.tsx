/**
 * The rating, asked after the feature has actually been used.
 *
 * The announcement carries a rating on its last step, and that was the only
 * place one existed — so the single moment a person could say how a feature
 * went was the moment they were first told about it, before they had touched
 * it. Once the walkthrough was done the announcement never returned, and with
 * it went the affordance. Milestone 6 asks for "thumbs up, thumbs down,
 * optional comment on every autonomously introduced widget, plugin, skill or
 * app" — a property of the feature, not of its introduction.
 *
 * So this asks at the moment there is something to say: announced, used, and
 * not yet rated. It disappears once rated, because an answered question asked
 * again is nagging — and a feature that is never used is not asked about at
 * all, because that case belongs to the unused-feature list, which surfaces
 * it for removal rather than for an opinion.
 *
 * Rendered beside `FeatureAnnouncement` and from the same `featureTrialsOn`
 * call, so a surface that announces its features also asks about them, in one
 * place rather than two obligations a future feature can meet by half.
 */

import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import { useFeatureTrialStore } from "#/stores/feature-trial-store";
import type { FeatureTrial } from "#/types/feature-trial";
import { FeatureRating } from "./feature-rating";

export interface FeatureFeedbackProps {
  /** The trials this surface owns, the same list the announcement takes. */
  trials: readonly FeatureTrial[];
}

export function FeatureFeedback({ trials }: FeatureFeedbackProps) {
  const { t } = useTranslation("openhands");
  const records = useFeatureTrialStore((state) => state.records);

  const asking = trials.filter((trial) => {
    const record = records[trial.id];
    return (
      record != null &&
      record.announcedAt !== null &&
      record.useCount > 0 &&
      record.rating === null
    );
  });

  if (asking.length === 0) return null;

  return (
    <section
      data-testid="feature-feedback"
      data-count={asking.length}
      className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-base-secondary p-3"
    >
      {asking.map((trial) => (
        <div key={trial.id} data-testid={`feature-feedback-${trial.id}`}>
          <p className="text-xs text-text-secondary">
            {t(I18nKey.FEATURE$FEEDBACK$ASK, { feature: t(trial.titleKey) })}
          </p>
          <FeatureRating trial={trial} className="mt-1.5" />
        </div>
      ))}
    </section>
  );
}
