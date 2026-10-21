import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import { RefreshCw } from "lucide-react";
import type { GitSyncStatus } from "#/types/git-sync";
import { formatTimeDelta } from "#/utils/format-time-delta";
import { browseUrlFor, displayUrlFor } from "#/utils/git-sync-repo-url";
import { cn } from "#/utils/utils";
import GitBranchIcon from "#/icons/git-branch.svg?react";
import GlobeIcon from "#/icons/globe.svg?react";
import FolderIcon from "#/icons/folder.svg?react";
import ClockIcon from "#/icons/clock.svg?react";
import { SectionCard } from "#/components/features/automations/detail/section-card";
import { ConfigField } from "#/components/features/automations/detail/config-field";
import { BrandButton } from "#/components/features/settings/brand-button";
import { GitSyncStatusPill } from "./git-sync-status-pill";
import {
  GitSyncActivityRow,
  type GitSyncActivityState,
} from "./git-sync-activity-row";

interface GitSyncOverviewSectionProps {
  status: GitSyncStatus;
  onSyncNow: () => void;
  isSyncing: boolean;
  syncActivity: GitSyncActivityState;
  syncStartedAt: string | null;
  canManage: boolean;
  /** Card heading; defaults to the single-repository "Sync Status". */
  title?: string;
  /** Extra pills next to the enabled and encryption ones (a remote's Default). */
  headerBadges?: ReactNode;
  /** Shown as a field when known: the automations this remote exports. */
  automationCount?: number;
  /** Rendered under the fields: a remote card's own actions. */
  children?: ReactNode;
}

export function GitSyncOverviewSection({
  status,
  onSyncNow,
  isSyncing,
  syncActivity,
  syncStartedAt,
  canManage,
  title,
  headerBadges,
  automationCount,
  children,
}: GitSyncOverviewSectionProps) {
  const { t } = useTranslation("openhands");
  const repoHref = browseUrlFor(status.repo_url);
  const repoLabel = displayUrlFor(status.repo_url);

  return (
    <SectionCard
      icon={<GitBranchIcon className="size-4" />}
      title={title ?? t(I18nKey.AUTOMATIONS$GIT_SYNC$STATUS_TITLE)}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {headerBadges}
          <GitSyncStatusPill
            testId="git-sync-enabled-pill"
            tone={status.enabled ? "success" : "neutral"}
            label={t(
              status.enabled
                ? I18nKey.AUTOMATIONS$GIT_SYNC$ENABLED
                : I18nKey.AUTOMATIONS$GIT_SYNC$DISABLED,
            )}
          />
          <GitSyncStatusPill
            testId="git-sync-encryption-pill"
            tone={status.encryption_enabled ? "success" : "neutral"}
            label={t(
              status.encryption_enabled
                ? I18nKey.AUTOMATIONS$GIT_SYNC$ENCRYPTED
                : I18nKey.AUTOMATIONS$GIT_SYNC$NOT_ENCRYPTED,
            )}
          />
        </div>
        <BrandButton
          testId="git-sync-now-button"
          type="button"
          variant="secondary"
          isDisabled={!canManage || !status.enabled || isSyncing}
          onClick={onSyncNow}
          startContent={
            <RefreshCw
              className={cn("size-4", isSyncing && "animate-spin")}
              aria-hidden
            />
          }
        >
          {t(
            isSyncing
              ? I18nKey.AUTOMATIONS$GIT_SYNC$SYNCING
              : I18nKey.AUTOMATIONS$GIT_SYNC$SYNC_NOW,
          )}
        </BrandButton>
      </div>

      <GitSyncActivityRow
        state={syncActivity}
        startedAt={syncStartedAt}
        pendingCount={status.dirty_count}
      />

      <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-5">
        <ConfigField
          icon={<GlobeIcon className="size-3.5" />}
          label={t(I18nKey.AUTOMATIONS$GIT_SYNC$REPOSITORY)}
        >
          {repoHref ? (
            <a
              data-testid="git-sync-repo-link"
              href={repoHref}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all underline transition-colors hover:text-foreground"
            >
              {repoLabel}
            </a>
          ) : (
            <span className="break-all">
              {repoLabel || t(I18nKey.AUTOMATIONS$GIT_SYNC$NOT_CONFIGURED)}
            </span>
          )}
        </ConfigField>

        <ConfigField
          icon={<GitBranchIcon className="size-3.5" />}
          label={t(I18nKey.AUTOMATIONS$GIT_SYNC$FIELD_BRANCH)}
        >
          {status.branch}
        </ConfigField>

        <ConfigField
          icon={<FolderIcon className="size-3.5" />}
          label={t(I18nKey.AUTOMATIONS$GIT_SYNC$FIELD_PATH)}
        >
          {status.path}
        </ConfigField>

        <ConfigField
          icon={<GitBranchIcon className="size-3.5" />}
          label={t(I18nKey.AUTOMATIONS$GIT_SYNC$LAST_SYNCED_COMMIT)}
        >
          {status.last_synced_commit ? (
            <span className="font-mono">
              {status.last_synced_commit.slice(0, 7)}
            </span>
          ) : (
            t(I18nKey.AUTOMATIONS$GIT_SYNC$NEVER_SYNCED)
          )}
        </ConfigField>

        <ConfigField
          icon={<ClockIcon className="size-3.5" />}
          label={t(I18nKey.AUTOMATIONS$GIT_SYNC$LAST_SYNCED_AT)}
        >
          {status.last_synced_at
            ? `${formatTimeDelta(status.last_synced_at)} ${t(I18nKey.CONVERSATION$AGO)}`
            : t(I18nKey.AUTOMATIONS$GIT_SYNC$NEVER_SYNCED)}
        </ConfigField>

        <ConfigField
          icon={<ClockIcon className="size-3.5" />}
          label={t(I18nKey.AUTOMATIONS$GIT_SYNC$FIELD_INTERVAL)}
        >
          {status.interval_seconds > 0
            ? t(I18nKey.AUTOMATIONS$GIT_SYNC$EVERY_N_SECONDS, {
                count: status.interval_seconds,
              })
            : t(I18nKey.AUTOMATIONS$GIT_SYNC$MANUAL_ONLY)}
        </ConfigField>

        <ConfigField
          icon={<ClockIcon className="size-3.5" />}
          label={t(I18nKey.AUTOMATIONS$GIT_SYNC$PENDING_CHANGES)}
        >
          <span className={cn(status.dirty_count > 0 && "text-warning")}>
            {status.dirty_count}
          </span>
        </ConfigField>

        {automationCount !== undefined && (
          <ConfigField
            icon={<FolderIcon className="size-3.5" />}
            label={t(I18nKey.AUTOMATIONS$GIT_SYNC$AUTOMATIONS_TITLE)}
          >
            <span data-testid="git-sync-automation-count">
              {automationCount}
            </span>
          </ConfigField>
        )}
      </div>

      {children}
    </SectionCard>
  );
}
