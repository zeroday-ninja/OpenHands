import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import { SectionCard } from "#/components/features/automations/detail/section-card";
import FolderIcon from "#/icons/folder.svg?react";
import {
  displayErrorToast,
  displaySuccessToast,
} from "#/utils/custom-toast-handlers";
import { getApiErrorMessage } from "#/utils/api-error-message";
import { formControlSettingsFieldClassName } from "#/utils/form-control-classes";
import { remoteDisplayName } from "#/utils/git-sync-repo-url";
import { cn } from "#/utils/utils";
import {
  useAssignGitSyncRemote,
  useGitSyncAssignments,
} from "#/hooks/query/use-git-sync";
import type { GitSyncRemoteStatus } from "#/types/git-sync";

interface GitSyncAssignmentsSectionProps {
  remotes: GitSyncRemoteStatus[];
  unassignedCount: number;
  canManage: boolean;
}

/**
 * Which repository each automation syncs to, one row per live automation
 * with a picker over the organization's remotes. An automation nobody
 * assigned shows the default remote, which is where its next cycle takes it.
 */
export function GitSyncAssignmentsSection({
  remotes,
  unassignedCount,
  canManage,
}: GitSyncAssignmentsSectionProps) {
  const { t } = useTranslation("openhands");
  const { data } = useGitSyncAssignments({ enabled: remotes.length > 0 });
  const assign = useAssignGitSyncRemote();
  const hasDefault = remotes.some((remote) => remote.is_default);
  const automations = data?.automations ?? [];

  const optionLabel = (remote: GitSyncRemoteStatus) =>
    remote.is_default
      ? `${remoteDisplayName(remote)} (${t(I18nKey.AUTOMATIONS$GIT_SYNC$DEFAULT_PILL)})`
      : remoteDisplayName(remote);

  const move = (automationId: string, remoteId: string) => {
    assign.mutate(
      { automationId, remoteId },
      {
        onSuccess: () =>
          displaySuccessToast(t(I18nKey.AUTOMATIONS$GIT_SYNC$AUTOMATION_MOVED)),
        onError: (error) =>
          displayErrorToast(
            getApiErrorMessage(error, t(I18nKey.ERROR$GENERIC)),
          ),
      },
    );
  };

  return (
    <SectionCard
      icon={<FolderIcon className="size-4" />}
      title={t(I18nKey.AUTOMATIONS$GIT_SYNC$AUTOMATIONS_TITLE)}
    >
      <p className="text-xs text-muted">
        {t(I18nKey.AUTOMATIONS$GIT_SYNC$ASSIGNMENTS_HELP)}
      </p>
      {/* Only worth saying when nothing will pick them up on its own. */}
      {!hasDefault && unassignedCount > 0 && (
        <p
          data-testid="git-sync-unassigned-count"
          className="mt-2 text-xs text-warning"
        >
          {t(I18nKey.AUTOMATIONS$GIT_SYNC$UNASSIGNED_COUNT, {
            count: unassignedCount,
          })}
        </p>
      )}

      {automations.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          {t(I18nKey.AUTOMATIONS$GIT_SYNC$NO_AUTOMATIONS)}
        </p>
      ) : (
        <ul className="mt-4 flex flex-col divide-y divide-border">
          {automations.map((automation) => (
            <li
              key={automation.automation_id}
              data-testid="git-sync-assignment-row"
              className="flex flex-wrap items-center justify-between gap-3 py-3"
            >
              <div className="min-w-0 flex-1 basis-48">
                <p className="truncate text-sm text-content">
                  {automation.name}
                </p>
                {automation.slug && (
                  <p className="truncate font-mono text-xs text-muted">
                    {automation.slug}
                  </p>
                )}
              </div>
              <select
                data-testid="git-sync-assignment-select"
                aria-label={t(I18nKey.AUTOMATIONS$GIT_SYNC$ASSIGN_TO, {
                  name: automation.name,
                })}
                className={cn(
                  formControlSettingsFieldClassName,
                  "w-auto min-w-48 max-w-full",
                )}
                value={automation.effective_remote_id ?? ""}
                disabled={!canManage || assign.isPending}
                onChange={(event) =>
                  move(automation.automation_id, event.target.value)
                }
              >
                {automation.effective_remote_id === null && (
                  <option value="" disabled>
                    {t(I18nKey.AUTOMATIONS$GIT_SYNC$NOT_CONFIGURED)}
                  </option>
                )}
                {remotes.map((remote) => (
                  <option key={remote.id} value={remote.id}>
                    {optionLabel(remote)}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
