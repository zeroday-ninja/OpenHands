import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import type { ImproveCycleReview } from "#/types/improve";
import { ImproveConversationLink } from "./improve-conversation-link";
import {
  ImproveVerdictBadge,
  improveVerdictExplanationKey,
} from "./improve-verdict-badge";

function ReviewEntry({ review }: { review: ImproveCycleReview }) {
  const { t } = useTranslation("openhands");
  // The runtime is the whole point of the review: it is what makes the check
  // independent of the builder. Name it even when the service did not report
  // one, so a reader is never left assuming a second runtime was involved.
  const runtime =
    review.runtime?.trim() || t(I18nKey.AUTOMATIONS$IMPROVE$RUNTIME_UNKNOWN);
  const explanationKey = review.verdict
    ? improveVerdictExplanationKey(review.verdict)
    : undefined;

  return (
    <li
      data-testid="improve-cycle-review"
      data-runtime={review.runtime ?? ""}
      className="rounded-xl border border-border bg-surface-raised px-3 py-2.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          {/* The runtime is its own element rather than interpolated copy so
              it stays readable next to the builder's, which it must differ
              from for the review to count as independent. */}
          <span className="flex min-w-0 items-baseline gap-1 text-xs text-muted">
            {t(I18nKey.AUTOMATIONS$IMPROVE$REVIEWER_LABEL)}
            <span
              data-testid="improve-review-runtime"
              className="truncate font-medium text-content"
            >
              {runtime}
            </span>
          </span>
          {/* The profile name only earns a line when it says something the
              runtime did not. Profiles are commonly named after their runtime,
              and repeating "codex" under "Reviewed by codex" reads as a bug. */}
          {review.profile_name && review.profile_name.trim() !== runtime ? (
            <span className="truncate text-xs text-muted">
              {review.profile_name}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <ImproveVerdictBadge
            verdict={review.verdict ?? null}
            testId="improve-review-verdict-badge"
          />
          {review.conversation_id ? (
            <ImproveConversationLink
              conversationId={review.conversation_id}
              label={t(I18nKey.AUTOMATIONS$IMPROVE$VIEW_REVIEW_CONVERSATION)}
              testId="improve-review-conversation-link"
            />
          ) : null}
        </div>
      </div>

      {explanationKey ? (
        <p className="mt-1.5 text-xs text-muted">{t(explanationKey)}</p>
      ) : null}

      {review.summary ? (
        <p className="mt-1.5 whitespace-pre-wrap text-xs text-content">
          {review.summary}
        </p>
      ) : null}

      {review.concerns.length > 0 ? (
        <div data-testid="improve-review-concerns" className="mt-2">
          <h6 className="text-xs font-semibold uppercase tracking-wide text-muted">
            {t(I18nKey.AUTOMATIONS$IMPROVE$REVIEW_CONCERNS)}
          </h6>
          <ul className="mt-1 list-disc pl-4 text-xs text-content">
            {review.concerns.map((concern) => (
              <li key={concern}>{concern}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {review.stale_sources.length > 0 ? (
        <div data-testid="improve-review-stale-sources" className="mt-2">
          <h6 className="text-xs font-semibold uppercase tracking-wide text-feedback-warning">
            {t(I18nKey.AUTOMATIONS$IMPROVE$REVIEW_STALE_SOURCES)}
          </h6>
          <ul className="mt-1 flex flex-col gap-0.5 text-xs">
            {review.stale_sources.map((source) => (
              <li key={source} className="min-w-0 truncate text-muted">
                {source}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </li>
  );
}

/**
 * Every runtime that reviewed the builder's change, each with its own
 * verdict, concerns and the sources it judged stale.
 */
export function ImproveCycleReviews({
  reviews,
}: {
  reviews: ImproveCycleReview[];
}) {
  const { t } = useTranslation("openhands");

  return (
    <div data-testid="improve-cycle-reviews" className="flex flex-col gap-1.5">
      <h5 className="text-xs font-semibold uppercase tracking-wide text-muted">
        {t(I18nKey.AUTOMATIONS$IMPROVE$REVIEWS_TITLE)}
      </h5>
      {reviews.length === 0 ? (
        <p className="text-xs text-muted">
          {t(I18nKey.AUTOMATIONS$IMPROVE$REVIEWS_EMPTY)}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {reviews.map((review, index) => (
            <ReviewEntry
              // Reviews are an ordered JSON list on the cycle with no id of
              // their own; the runtime plus position is what identifies one.
              key={`${review.runtime ?? index}-${review.conversation_id ?? index}`}
              review={review}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
