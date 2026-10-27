/**
 * Introducing something the app built for you.
 *
 * A cycle that ships a surface has to say so, or the only way to find out is
 * to notice. The walkthrough **points at** what it is describing rather than
 * describing it from a distance: each step names an element, and the step
 * scrolls to it and outlines it while it is on screen.
 *
 * Shown once. "Later" dismisses without marking it announced, so it comes back;
 * "Got it" marks it, which is also the date the fourteen-day unused clock runs
 * from — a feature cannot be judged unused before anyone was told it existed.
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { Sparkles } from "lucide-react";
import { I18nKey } from "#/i18n/declaration";
import { OnboardingProgressBar } from "#/components/features/onboarding/onboarding-progress-bar";
import { useFeatureTrialStore } from "#/stores/feature-trial-store";
import type { FeatureTrial } from "#/types/feature-trial";
import { FeatureRating } from "./feature-rating";

const ICON_SIZE = 16;

const BUTTON_CLASS =
  "inline-flex items-center gap-1.5 rounded-md border border-border-subtle px-3 py-1.5 text-xs text-text-secondary hover:bg-interactive-hover";

/** The outline a walkthrough step draws on what it is talking about. */
const HIGHLIGHT_CLASS = "outline outline-2 outline-offset-2 outline-warning";

export interface FeatureAnnouncementProps {
  /** Which trials this surface may announce. */
  trials: readonly FeatureTrial[];
}

export function FeatureAnnouncement({ trials }: FeatureAnnouncementProps) {
  const { t } = useTranslation("openhands");
  const records = useFeatureTrialStore((state) => state.records);
  const markAnnounced = useFeatureTrialStore((state) => state.markAnnounced);
  const [dismissed, setDismissed] = React.useState<string[]>([]);
  const [step, setStep] = React.useState(0);

  const trial =
    trials.find(
      (candidate) =>
        !records[candidate.id]?.announcedAt &&
        !dismissed.includes(candidate.id),
    ) ?? null;

  const current = trial?.steps[step] ?? null;
  const target = current?.testId ?? null;

  // The highlight is applied to the real element rather than drawn over it, so
  // a step always points at what is actually on screen — including when the
  // element has moved, and including not at all when it is missing.
  React.useEffect(() => {
    if (!target) return undefined;
    const element = window.document.querySelector(`[data-testid="${target}"]`);
    if (!element) return undefined;
    element.classList.add(...HIGHLIGHT_CLASS.split(" "));
    // Scrolling is the nicety and the outline is the point, so a host without
    // `scrollIntoView` loses the scroll rather than the whole walkthrough: an
    // exception here would throw out of an effect and take the panel with it.
    //
    // And only when the target cannot be seen at all. A step's target is
    // usually in the same scrolling column as this panel and often taller
    // than it, so any scroll at all moves the panel out of view: centring
    // took the map's rail 1421 px down a 627 px column, and even the
    // smallest scroll left the reader with the explanation off screen.
    // Something already on screen does not need bringing onto it; the
    // outline is what says which one it is.
    const box = element.getBoundingClientRect();
    const onScreen = box.top < window.innerHeight && box.bottom > 0;
    if (!onScreen && typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    return () => element.classList.remove(...HIGHLIGHT_CLASS.split(" "));
  }, [target]);

  if (trial === null || current === null) return null;

  const last = step >= trial.steps.length - 1;

  return (
    <section
      data-testid="feature-announcement"
      data-feature-id={trial.id}
      data-step={step}
      aria-live="polite"
      className="flex flex-col gap-2 rounded-lg border border-accent/40 bg-accent/5 p-3"
    >
      <header className="flex items-baseline gap-2">
        <Sparkles size={ICON_SIZE} aria-hidden className="text-accent" />
        <h3 className="text-sm font-medium text-contrast">
          {t(I18nKey.FEATURE$ANNOUNCE$HEADING)}
        </h3>
        <p className="text-sm text-text-secondary">{t(trial.titleKey)}</p>
      </header>
      <p className="text-xs text-text-secondary">{t(trial.summaryKey)}</p>
      <OnboardingProgressBar
        currentStep={step}
        totalSteps={trial.steps.length}
      />
      <p className="text-xs text-muted">
        {t(I18nKey.FEATURE$ANNOUNCE$STEP_OF, {
          current: step + 1,
          total: trial.steps.length,
        })}
      </p>
      <h4 className="text-sm font-medium text-contrast">
        {t(current.titleKey)}
      </h4>
      <p className="text-xs text-text-secondary">{t(current.bodyKey)}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {!last && (
          <button
            type="button"
            data-testid="feature-announcement-next"
            className={BUTTON_CLASS}
            onClick={() => setStep((value) => value + 1)}
          >
            {t(I18nKey.FEATURE$ANNOUNCE$NEXT)}
          </button>
        )}
        {last && (
          <button
            type="button"
            data-testid="feature-announcement-done"
            className={BUTTON_CLASS}
            onClick={() => markAnnounced(trial.id)}
          >
            {t(I18nKey.FEATURE$ANNOUNCE$DONE)}
          </button>
        )}
        <button
          type="button"
          data-testid="feature-announcement-later"
          // Dismissed for this visit only, deliberately: an announcement
          // nobody read is an announcement that did not happen, and marking
          // it shown would start the unused clock on a feature nobody heard
          // about.
          className={BUTTON_CLASS}
          onClick={() => setDismissed((value) => [...value, trial.id])}
        >
          {t(I18nKey.FEATURE$ANNOUNCE$LATER)}
        </button>
      </div>
      {last && <FeatureRating trial={trial} />}
    </section>
  );
}
