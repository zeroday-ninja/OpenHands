import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { I18nKey } from "#/i18n/declaration";
import { getErrorStatus } from "#/hooks/query/use-settings";
import {
  useGitSyncRemotes,
  useTriggerGitSyncRemote,
} from "#/hooks/query/use-git-sync";
import { useAutomationHealth } from "#/hooks/query/use-automation-health";
import { useAutomationPermissions } from "#/hooks/use-automation-permissions";
import { BackLink } from "#/components/features/automations/detail/back-link";
import { ErrorState } from "#/components/features/automations/error-state";
import { BackendNotConfigured } from "#/components/features/automations/backend-not-configured";
import { BrandButton } from "#/components/features/settings/brand-button";
import { GitSyncSkeleton } from "#/components/features/automations/git-sync/git-sync-skeleton";
import { GitSyncNoAccessState } from "#/components/features/automations/git-sync/git-sync-no-access-state";
import { GitSyncRemoteCard } from "#/components/features/automations/git-sync/git-sync-remote-card";
import { GitSyncAssignmentsSection } from "#/components/features/automations/git-sync/git-sync-assignments-section";
import {
  GitSyncConfigForm,
  NEW_REMOTE_STATUS,
} from "#/components/features/automations/git-sync/git-sync-config-form";
import {
  GIT_SYNC_IDLE_POLL_INTERVAL_MS,
  GIT_SYNC_POLL_INTERVAL_MS,
  GitSyncSingleRemotePage,
} from "#/components/features/automations/git-sync/git-sync-single-remote-page";
import type { GitSyncRemoteStatus } from "#/types/git-sync";

function PageFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full">
      <div className="p-6 max-w-4xl mx-auto">{children}</div>
    </div>
  );
}

/**
 * Every repository the organization syncs, one card each, plus the form that
 * adds one and the list that says which repository each automation goes to.
 */
function GitSyncRemotesPage({ canManage }: { canManage: boolean }) {
  const { t } = useTranslation("openhands");
  // The remotes whose cycle a card is following. While any is, the list is
  // polled closely so the outcome lands without a refresh.
  const [runningRemotes, setRunningRemotes] = useState<Set<string>>(
    () => new Set(),
  );
  const onRunningChange = useCallback(
    (remoteId: string, isRunning: boolean) => {
      setRunningRemotes((current) => {
        if (current.has(remoteId) === isRunning) return current;
        const next = new Set(current);
        if (isRunning) next.add(remoteId);
        else next.delete(remoteId);
        return next;
      });
    },
    [],
  );

  const { data, isLoading, error, refetch } = useGitSyncRemotes({
    enabled: canManage,
    refetchInterval:
      runningRemotes.size > 0
        ? GIT_SYNC_POLL_INTERVAL_MS
        : GIT_SYNC_IDLE_POLL_INTERVAL_MS,
  });
  const [isAdding, setIsAdding] = useState(false);
  // A repository just added opens with its configuration showing, so a
  // token or branch typo is one click from being fixed.
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const trigger = useTriggerGitSyncRemote();

  if (isLoading) {
    return <GitSyncSkeleton />;
  }

  // The backend has no remotes API: it syncs one repository per organization
  // through the older endpoints, so show that page rather than an error.
  if (!data && getErrorStatus(error) === 404) {
    return <GitSyncSingleRemotePage canManage={canManage} />;
  }
  // A missing list replaces the page; a failed background poll with one
  // still cached does not, so nothing half-typed in a form is lost.
  if (!data) {
    return <ErrorState onRetry={() => refetch()} />;
  }

  const { remotes, unassigned_count: unassignedCount } = data;

  const handleCreated = (remote: GitSyncRemoteStatus, thenSync: boolean) => {
    setIsAdding(false);
    setJustAddedId(remote.id);
    // Off the stored configuration, so only once the create has landed; the
    // card's activity row picks the cycle up from `sync_in_progress`.
    if (thenSync) trigger.mutate(remote.id);
  };

  return (
    <div className="flex flex-col gap-4">
      <BackLink />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="text-xl font-semibold text-content">
            {t(I18nKey.AUTOMATIONS$GIT_SYNC$TITLE)}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {t(I18nKey.AUTOMATIONS$GIT_SYNC$SUBTITLE_MULTI)}
          </p>
          <p className="mt-1 text-xs text-muted">
            {t(I18nKey.AUTOMATIONS$GIT_SYNC$DEFAULT_HELP)}
          </p>
        </div>
        {canManage && !isAdding && (
          <BrandButton
            testId="git-sync-add-remote-button"
            type="button"
            variant="primary"
            className="whitespace-nowrap"
            onClick={() => setIsAdding(true)}
            startContent={<Plus className="size-4" aria-hidden />}
          >
            {t(I18nKey.AUTOMATIONS$GIT_SYNC$ADD_REPOSITORY)}
          </BrandButton>
        )}
      </div>

      {isAdding && (
        <GitSyncConfigForm
          status={NEW_REMOTE_STATUS}
          canManage={canManage}
          onSyncNow={() => undefined}
          remote={{ id: null, label: "" }}
          onCreated={handleCreated}
          onCancel={() => setIsAdding(false)}
        />
      )}

      {remotes.length === 0 && !isAdding && (
        <p
          data-testid="git-sync-no-remotes"
          className="rounded-2xl border border-dashed border-border px-5 py-8 text-center text-sm text-muted"
        >
          {t(I18nKey.AUTOMATIONS$GIT_SYNC$NO_REPOSITORIES)}
        </p>
      )}

      {remotes.map((remote) => (
        <GitSyncRemoteCard
          key={remote.id}
          remote={remote}
          canManage={canManage}
          onRunningChange={onRunningChange}
          initiallyConfiguring={remote.id === justAddedId}
        />
      ))}

      {remotes.length > 0 && (
        <GitSyncAssignmentsSection
          remotes={remotes}
          unassignedCount={unassignedCount}
          canManage={canManage}
        />
      )}
    </div>
  );
}

export default function AutomationGitSync() {
  // Git sync is an org-level operation (not per-automation), so there is no
  // creator escape hatch: only users with manage_automations (org admins and
  // owners) may see, configure, check, or trigger a sync. Local backends
  // always grant it; on cloud it comes from the org's /me permissions.
  const { canManage, isLoading: isPermissionsLoading } =
    useAutomationPermissions();
  const {
    data: healthData,
    isLoading: isHealthLoading,
    refetch: refetchHealth,
  } = useAutomationHealth();
  const isBackendHealthy = healthData?.status === "ok";

  if (isHealthLoading || isPermissionsLoading) {
    return (
      <PageFrame>
        <GitSyncSkeleton />
      </PageFrame>
    );
  }

  if (!canManage) {
    return (
      <PageFrame>
        <GitSyncNoAccessState />
      </PageFrame>
    );
  }

  if (!isBackendHealthy) {
    return (
      <PageFrame>
        <BackendNotConfigured onRetry={refetchHealth} />
      </PageFrame>
    );
  }

  return (
    <PageFrame>
      <GitSyncRemotesPage canManage={canManage} />
    </PageFrame>
  );
}
