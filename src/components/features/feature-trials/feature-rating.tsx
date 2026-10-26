/**
 * How did that go?
 *
 * A thumbs up or down on something the app introduced on its own, with a
 * comment if there is more to say. Three rules it follows:
 *
 * - **the rating never waits for the comment.** One click is a complete
 *   answer, and a form that demands prose collects nothing.
 * - **it is kept locally either way.** The rating goes to the agents as a
 *   correction, and when that fails it is still recorded here and the failure
 *   is said out loud — a rating that silently vanished is worse than none,
 *   because the person believes they have told you.
 * - **a thumbs-down is a correction, not a vote.** It is filed under the
 *   learn-a-lesson-once rule, so it reaches the next cycle without the user
 *   having to accept a proposal first.
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { I18nKey } from "#/i18n/declaration";
import { useCaptureFeatureFeedback } from "#/hooks/mutation/use-capture-feature-feedback";
import {
  MAX_FEATURE_COMMENT,
  useFeatureTrialStore,
} from "#/stores/feature-trial-store";
import type { FeatureTrial } from "#/types/feature-trial";
import { cn } from "#/utils/utils";

const ICON_SIZE = 14;

const BUTTON_CLASS =
  "inline-flex items-center gap-1.5 rounded-md border border-border-subtle px-2 py-1 text-xs text-text-secondary hover:bg-interactive-hover";

export interface FeatureRatingProps {
  trial: FeatureTrial;
  className?: string;
}

export function FeatureRating({ trial, className }: FeatureRatingProps) {
  const { t } = useTranslation("openhands");
  const record = useFeatureTrialStore((state) => state.records[trial.id]);
  const rate = useFeatureTrialStore((state) => state.rate);
  const capture = useCaptureFeatureFeedback();
  const [comment, setComment] = React.useState("");
  const commentId = `feature-comment-${trial.id}`;

  const send = (rating: "up" | "down", text: string | null) => {
    rate(trial.id, rating, text);
    capture.mutate({ trial, rating, comment: text });
  };

  const rated = record?.rating ?? null;

  return (
    <div
      data-testid="feature-rating"
      data-feature-id={trial.id}
      data-rating={rated ?? undefined}
      className={cn("flex flex-col gap-1.5", className)}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-text-secondary">
          {t(I18nKey.FEATURE$RATE$PROMPT)}
        </span>
        <button
          type="button"
          data-testid="feature-rating-up"
          aria-pressed={rated === "up"}
          className={cn(
            BUTTON_CLASS,
            rated === "up" && "bg-interactive-selected",
          )}
          onClick={() => send("up", comment.trim() || null)}
        >
          <ThumbsUp size={ICON_SIZE} aria-hidden />
          {t(I18nKey.FEATURE$RATE$UP)}
        </button>
        <button
          type="button"
          data-testid="feature-rating-down"
          aria-pressed={rated === "down"}
          className={cn(
            BUTTON_CLASS,
            rated === "down" && "bg-interactive-selected",
          )}
          onClick={() => send("down", comment.trim() || null)}
        >
          <ThumbsDown size={ICON_SIZE} aria-hidden />
          {t(I18nKey.FEATURE$RATE$DOWN)}
        </button>
      </div>
      <label htmlFor={commentId} className="text-xs text-muted">
        {t(I18nKey.FEATURE$RATE$COMMENT_LABEL)}
      </label>
      <div className="flex items-start gap-1.5">
        <textarea
          id={commentId}
          data-testid="feature-rating-comment"
          value={comment}
          maxLength={MAX_FEATURE_COMMENT}
          rows={2}
          onChange={(event) => setComment(event.target.value)}
          className="w-full rounded-md border border-border-subtle bg-canvas-base p-2 text-xs text-contrast"
        />
        <button
          type="button"
          data-testid="feature-rating-comment-send"
          // Only once a rating exists: a comment with no rating has nothing
          // to be a comment *on*, and would reach the agents as an opinion
          // with no polarity.
          disabled={rated === null || !comment.trim()}
          className={BUTTON_CLASS}
          onClick={() => send(rated ?? "up", comment.trim())}
        >
          {t(I18nKey.FEATURE$RATE$COMMENT_SEND)}
        </button>
      </div>
      {rated !== null && (
        <p
          data-testid="feature-rating-outcome"
          data-reached-agents={capture.isError ? "false" : "true"}
          className={cn(
            "text-xs",
            capture.isError ? "text-warning" : "text-muted",
          )}
        >
          {t(
            capture.isError
              ? I18nKey.FEATURE$RATE$NOT_SENT
              : I18nKey.FEATURE$RATE$THANKS,
          )}
        </p>
      )}
    </div>
  );
}
