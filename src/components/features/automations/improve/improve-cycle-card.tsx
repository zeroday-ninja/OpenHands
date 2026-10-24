import { useTranslation } from "react-i18next";
import { ExternalLink, GitBranch, GitMerge } from "lucide-react";
import { I18nKey } from "#/i18n/declaration";
import type { ImproveCycle } from "#/types/improve";
import {
  formatRelativeTime,
  isInvalidTimestamp,
} from "#/utils/format-relative-time";
import {
  improveCommitUrl,
  improveRepositoryDisplayName,
} from "#/utils/improve-program";
import { ImproveCitedSources } from "./improve-cited-sources";
import { ImproveConversationLink } from "./improve-conversation-link";
import { ImproveCycleReviews } from "./improve-cycle-reviews";
import { ImproveCycleStatusBadge } from "./improve-cycle-status-badge";
import { ImproveSoulSuggestions } from "./improve-soul-suggestions";
import {
  ImproveVerdictBadge,
  improveVerdictExplanationKey,
} from "./improve-verdict-badge";

/**
 * One cycle: which repository it took, what the builder did and where, and
 * what every other runtime concluded about it.
 */
export function ImproveCycleCard({ cycle }: { cycle: ImproveCycle }) {
  const { t, i18n } = useTranslation("openhands");
  const repositoryName = improveRepositoryDisplayName(cycle.repository);
  const builderRuntime =
    cycle.builder_runtime?.trim() ||
    t(I18nKey.AUTOMATIONS$IMPROVE$RUNTIME_UNKNOWN);
  const verdictExplanationKey = cycle.verdict
    ? improveVerdictExplanationKey(cycle.verdict)
    : undefined;
  const startedAt = isInvalidTimestamp(cycle.created_at)
    ? null
    : cycle.created_at;
  // Only a recorded merge is shown. A service from before the merge was
  // recorded sends neither field, and absence there means "not known", not
  // "did not merge" — so nothing is rendered rather than something false.
  const mergedSha = cycle.merged_at
    ? cycle.merge_commit_sha?.trim()
    : undefined;
  const commitUrl = mergedSha
    ? improveCommitUrl(cycle.repository.url, mergedSha)
    : null;

  return (
    <li
      data-testid="improve-cycle-card"
      data-cycle-id={cycle.id}
      className="flex flex-col gap-3 rounded-2xl border border-border bg-surface px-4 py-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="truncate text-sm font-medium text-content">
            {repositoryName}
          </h4>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            {startedAt ? (
              <time dateTime={startedAt}>
                {formatRelativeTime(startedAt, i18n.language, t)}
              </time>
            ) : null}
            <span className="flex items-baseline gap-1">
              {t(I18nKey.AUTOMATIONS$IMPROVE$BUILDER_LABEL)}
              <span
                data-testid="improve-cycle-builder-runtime"
                className="font-medium text-content"
              >
                {builderRuntime}
              </span>
            </span>
            {cycle.builder_conversation_id ? (
              <ImproveConversationLink
                conversationId={cycle.builder_conversation_id}
                label={t(I18nKey.AUTOMATIONS$IMPROVE$VIEW_BUILDER_CONVERSATION)}
                testId="improve-builder-conversation-link"
              />
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ImproveCycleStatusBadge status={cycle.status} />
          <ImproveVerdictBadge
            verdict={cycle.verdict}
            testId="improve-cycle-verdict-badge"
          />
        </div>
      </div>

      {verdictExplanationKey ? (
        <p
          data-testid="improve-cycle-verdict-explanation"
          className="text-xs text-muted"
        >
          {t(verdictExplanationKey)}
        </p>
      ) : null}

      {cycle.branch || cycle.pr_url || cycle.merged_at ? (
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {cycle.branch ? (
            <span className="inline-flex min-w-0 items-center gap-1 rounded-full border border-border bg-surface-raised px-2.5 py-0.5 text-muted">
              <GitBranch className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{cycle.branch}</span>
            </span>
          ) : null}
          {cycle.pr_url ? (
            <a
              data-testid="improve-cycle-pr-link"
              href={cycle.pr_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              {t(I18nKey.AUTOMATIONS$IMPROVE$PULL_REQUEST)}
              <ExternalLink className="size-3" aria-hidden />
            </a>
          ) : null}
          {/* An additive change merges without asking, so the one place the
              user finds out it happened is here. */}
          {cycle.merged_at ? (
            <span
              data-testid="improve-cycle-merged"
              className="inline-flex min-w-0 items-center gap-1 text-feedback-success"
            >
              <GitMerge className="size-3 shrink-0" aria-hidden />
              {t(I18nKey.AUTOMATIONS$IMPROVE$MERGED)}
              {mergedSha ? (
                <>
                  {" "}
                  {commitUrl ? (
                    <a
                      data-testid="improve-cycle-merge-commit"
                      href={commitUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono hover:underline"
                    >
                      {mergedSha.slice(0, 7)}
                    </a>
                  ) : (
                    <span
                      data-testid="improve-cycle-merge-commit"
                      className="font-mono"
                    >
                      {mergedSha.slice(0, 7)}
                    </span>
                  )}
                </>
              ) : null}
            </span>
          ) : null}
        </div>
      ) : null}

      <p
        data-testid="improve-cycle-summary"
        className="whitespace-pre-wrap text-sm text-content"
      >
        {cycle.summary || t(I18nKey.AUTOMATIONS$IMPROVE$NO_SUMMARY)}
      </p>

      {cycle.error ? (
        <p
          data-testid="improve-cycle-error"
          className="whitespace-pre-wrap text-xs text-feedback-error"
        >
          {cycle.error}
        </p>
      ) : null}

      <ImproveCitedSources sources={cycle.sources} />
      <ImproveCycleReviews reviews={cycle.reviews} />
      {/* Last, and visibly its own thing: everything above is about the
          repository, this is about the user. */}
      <ImproveSoulSuggestions suggestions={cycle.soul_suggestions} />
    </li>
  );
}
