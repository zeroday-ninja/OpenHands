import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import { BrandButton } from "#/components/features/settings/brand-button";
import { ConfirmationModal } from "#/components/shared/modals/confirmation-modal";
import {
  displayErrorToast,
  displaySuccessToast,
} from "#/utils/custom-toast-handlers";
import { getApiErrorMessage } from "#/utils/api-error-message";
import { getErrorStatus } from "#/hooks/query/use-settings";
import { useGitSyncActivity } from "#/hooks/use-git-sync-activity";
import {
  useDeleteGitSyncRemote,
  useTriggerGitSyncRemote,
  useUpdateGitSyncRemote,
} from "#/hooks/query/use-git-sync";
import { remoteDisplayName } from "#/utils/git-sync-repo-url";
import type { GitSyncRemoteStatus } from "#/types/git-sync";
import { GitSyncErrorBanner } from "./git-sync-error-banner";
import { GitSyncOverviewSection } from "./git-sync-overview-section";
import { GitSyncConfigForm } from "./git-sync-config-form";
import { GitSyncStatusPill } from "./git-sync-status-pill";

interface GitSyncRemoteCardProps {
  remote: GitSyncRemoteStatus;
  canManage: boolean;
  /**
   * Tells the page whether this remote's cycle is being followed, so it can
   * poll the list closely while any card is running.
   */
  onRunningChange: (remoteId: string, isRunning: boolean) => void;
  /** Open with the configuration form showing (a repository just added). */
  initiallyConfiguring?: boolean;
}

/**
 * One repository of the organization: its status card, its own Sync now,
 * Make default and Remove, and -- folded away until asked for -- its
 * configuration form.
 */
export function GitSyncRemoteCard({
  remote,
  canManage,
  onRunningChange,
  initiallyConfiguring = false,
}: GitSyncRemoteCardProps) {
  const { t } = useTranslation("openhands");
  const activity = useGitSyncActivity(remote);
  const trigger = useTriggerGitSyncRemote();
  const update = useUpdateGitSyncRemote();
  const remove = useDeleteGitSyncRemote();
  const [isConfiguring, setIsConfiguring] = useState(initiallyConfiguring);
  const [isConfirmingRemoval, setIsConfirmingRemoval] = useState(false);

  const { isRunning } = activity;
  useEffect(() => {
    onRunningChange(remote.id, isRunning);
  }, [remote.id, isRunning, onRunningChange]);
  // A card that unmounts mid-cycle (its remote was removed) must not leave
  // the page polling closely forever.
  useEffect(
    () => () => onRunningChange(remote.id, false),
    [remote.id, onRunningChange],
  );

  const handleSyncNow = () => {
    trigger.mutate(remote.id, {
      // No success toast: the trigger only means the cycle was scheduled, and
      // a toast that fires and disappears can't report how it ends. The
      // activity row follows it through to its outcome instead -- including
      // when `triggered` is false, which means a cycle was already running
      // and is the one to follow.
      onSuccess: () => activity.markRunning(),
      onError: (error) => {
        displayErrorToast(
          getErrorStatus(error) === 503
            ? t(I18nKey.AUTOMATIONS$GIT_SYNC$SYNC_DISABLED_ERROR)
            : getApiErrorMessage(error, t(I18nKey.ERROR$GENERIC)),
        );
      },
    });
  };

  const handleMakeDefault = () => {
    update.mutate(
      { remoteId: remote.id, body: { is_default: true } },
      {
        onSuccess: () =>
          displaySuccessToast(t(I18nKey.AUTOMATIONS$GIT_SYNC$CONFIG_SAVED)),
        onError: (error) =>
          displayErrorToast(
            getApiErrorMessage(error, t(I18nKey.ERROR$GENERIC)),
          ),
      },
    );
  };

  const handleRemove = () => {
    remove.mutate(remote.id, {
      onSuccess: () => {
        setIsConfirmingRemoval(false);
        displaySuccessToast(t(I18nKey.AUTOMATIONS$GIT_SYNC$REPOSITORY_REMOVED));
      },
      onError: (error) => {
        setIsConfirmingRemoval(false);
        displayErrorToast(getApiErrorMessage(error, t(I18nKey.ERROR$GENERIC)));
      },
    });
  };

  return (
    <div
      data-testid="git-sync-remote-card"
      data-remote-id={remote.id}
      data-default={remote.is_default ? "true" : "false"}
      className="flex flex-col gap-4"
    >
      {remote.last_error && (
        <GitSyncErrorBanner
          error={remote.last_error}
          errorAt={remote.last_error_at}
        />
      )}
      <GitSyncOverviewSection
        status={remote}
        title={
          remoteDisplayName(remote) ||
          t(I18nKey.AUTOMATIONS$GIT_SYNC$NOT_CONFIGURED)
        }
        headerBadges={
          remote.is_default ? (
            <GitSyncStatusPill
              testId="git-sync-default-pill"
              tone="warning"
              label={t(I18nKey.AUTOMATIONS$GIT_SYNC$DEFAULT_PILL)}
            />
          ) : null
        }
        automationCount={remote.automation_count}
        onSyncNow={handleSyncNow}
        // The POST returns as soon as the cycle is scheduled, so the
        // activity state is what tracks the sync actually running.
        isSyncing={trigger.isPending || isRunning}
        syncActivity={activity.state}
        syncStartedAt={activity.startedAt}
        canManage={canManage}
      >
        {canManage && (
          <div className="mt-5 flex flex-wrap gap-2">
            <BrandButton
              testId="git-sync-configure-button"
              type="button"
              variant="secondary"
              onClick={() => setIsConfiguring((open) => !open)}
              aria-expanded={isConfiguring}
            >
              {t(
                isConfiguring
                  ? I18nKey.AUTOMATIONS$GIT_SYNC$HIDE_CONFIGURATION
                  : I18nKey.AUTOMATIONS$GIT_SYNC$CONFIGURE,
              )}
            </BrandButton>
            {!remote.is_default && (
              <BrandButton
                testId="git-sync-make-default-button"
                type="button"
                variant="secondary"
                isDisabled={update.isPending}
                onClick={handleMakeDefault}
              >
                {t(I18nKey.AUTOMATIONS$GIT_SYNC$MAKE_DEFAULT)}
              </BrandButton>
            )}
            <BrandButton
              testId="git-sync-remove-button"
              type="button"
              variant="ghost-danger"
              isDisabled={remove.isPending}
              onClick={() => setIsConfirmingRemoval(true)}
            >
              {t(I18nKey.COMMON$REMOVE)}
            </BrandButton>
          </div>
        )}
      </GitSyncOverviewSection>

      {isConfiguring && (
        <GitSyncConfigForm
          status={remote}
          canManage={canManage}
          onSyncNow={handleSyncNow}
          remote={{ id: remote.id, label: remote.label }}
        />
      )}

      {isConfirmingRemoval && (
        <ConfirmationModal
          text={`${t(I18nKey.AUTOMATIONS$GIT_SYNC$REMOVE_CONFIRM_TITLE)} ${t(I18nKey.AUTOMATIONS$GIT_SYNC$REMOVE_CONFIRM_MESSAGE)}`}
          confirmText={t(I18nKey.COMMON$REMOVE)}
          isConfirming={remove.isPending}
          onConfirm={handleRemove}
          onCancel={() => setIsConfirmingRemoval(false)}
        />
      )}
    </div>
  );
}
