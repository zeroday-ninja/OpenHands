import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import { displayErrorToast } from "#/utils/custom-toast-handlers";
import { getApiErrorMessage } from "#/utils/api-error-message";
import { getErrorStatus } from "#/hooks/query/use-settings";
import {
  useGitSyncStatus,
  useTriggerGitSync,
} from "#/hooks/query/use-git-sync";
import { useGitSyncActivity } from "#/hooks/use-git-sync-activity";
import { BackLink } from "#/components/features/automations/detail/back-link";
import { ErrorState } from "#/components/features/automations/error-state";
import { GitSyncSkeleton } from "./git-sync-skeleton";
import { GitSyncUnsupportedState } from "./git-sync-unsupported-state";
import { GitSyncErrorBanner } from "./git-sync-error-banner";
import { GitSyncOverviewSection } from "./git-sync-overview-section";
import { GitSyncConfigForm } from "./git-sync-config-form";

// While a cycle is running the status is followed closely, so its result
// (new commit, dirty count, or error) lands without a page refresh; the idle
// cadence exists to notice a cycle the backend's own interval started.
export const GIT_SYNC_POLL_INTERVAL_MS = 3_000;
export const GIT_SYNC_IDLE_POLL_INTERVAL_MS = 15_000;

interface GitSyncSingleRemotePageProps {
  canManage: boolean;
}

/**
 * The Git Sync page for an automation backend that syncs one repository per
 * organization: the surface every backend before remotes had, kept so an
 * older backend keeps its page. Health and permissions are checked by the
 * route before this renders.
 */
export function GitSyncSingleRemotePage({
  canManage,
}: GitSyncSingleRemotePageProps) {
  const { t } = useTranslation("openhands");
  // The status drives the activity and the activity decides how often the
  // status is polled; the state breaks that cycle one render later.
  const [isFollowingCycle, setIsFollowingCycle] = useState(false);
  const {
    data: status,
    isLoading,
    error,
    refetch,
  } = useGitSyncStatus({
    enabled: canManage,
    refetchInterval: isFollowingCycle
      ? GIT_SYNC_POLL_INTERVAL_MS
      : GIT_SYNC_IDLE_POLL_INTERVAL_MS,
  });
  const activity = useGitSyncActivity(status);
  useEffect(() => {
    setIsFollowingCycle(activity.isRunning);
  }, [activity.isRunning]);

  const triggerMutation = useTriggerGitSync();

  if (isLoading) {
    return <GitSyncSkeleton />;
  }

  // A missing status replaces the page; a failure with one still cached does
  // not. `isError` alone is true for a failed background poll too, and this
  // page polls every few seconds after a sync -- unmounting on one of those
  // would throw away whatever is half-typed in the config form below.
  if (!status) {
    return getErrorStatus(error) === 404 ? (
      <GitSyncUnsupportedState />
    ) : (
      <ErrorState onRetry={() => refetch()} />
    );
  }

  const handleSyncNow = () => {
    triggerMutation.mutate(undefined, {
      // No success toast: the trigger only means the cycle was scheduled, and
      // a toast that fires and disappears can't report how it ends. The
      // activity row in the card follows it through to its outcome instead --
      // including when `triggered` is false, which means a cycle was already
      // running and is the one to follow.
      onSuccess: () => activity.markRunning(),
      onError: (mutationError) => {
        displayErrorToast(
          getErrorStatus(mutationError) === 503
            ? t(I18nKey.AUTOMATIONS$GIT_SYNC$SYNC_DISABLED_ERROR)
            : getApiErrorMessage(mutationError, t(I18nKey.ERROR$GENERIC)),
        );
      },
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <BackLink />
      <div>
        <h1 className="text-xl font-semibold text-content">
          {t(I18nKey.AUTOMATIONS$GIT_SYNC$TITLE)}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {t(I18nKey.AUTOMATIONS$GIT_SYNC$SUBTITLE)}
        </p>
      </div>
      {status.last_error && (
        <GitSyncErrorBanner
          error={status.last_error}
          errorAt={status.last_error_at}
        />
      )}
      <GitSyncOverviewSection
        status={status}
        onSyncNow={handleSyncNow}
        // The POST returns as soon as the cycle is scheduled, so the
        // activity state is what tracks the sync actually running.
        isSyncing={triggerMutation.isPending || activity.isRunning}
        syncActivity={activity.state}
        syncStartedAt={activity.startedAt}
        canManage={canManage}
      />
      <GitSyncConfigForm
        status={status}
        canManage={canManage}
        onSyncNow={handleSyncNow}
      />
    </div>
  );
}
