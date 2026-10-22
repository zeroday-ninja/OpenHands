import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BrandButton } from "#/components/features/settings/brand-button";
import { AgentRuntimeProfileRow } from "./agent-runtime-profile-row";
import { DeleteAgentProfileModal } from "#/components/features/settings/agent-profiles/delete-agent-profile-modal";
import { type AgentProfileSummary } from "#/api/agent-profiles-service/agent-profiles-service.api";
import { useAgentProfiles } from "#/hooks/query/use-agent-profiles";
import { useAgentRuntimeProfiles } from "#/hooks/query/use-agent-runtime-profiles";
import { useActivateAgentProfile } from "#/hooks/mutation/use-activate-agent-profile";
import { useCanManageOrgProfiles } from "#/hooks/use-can-manage-org-profiles";
import { LoadingSpinner } from "#/components/shared/loading-spinner";
import { displaySuccessToast } from "#/utils/custom-toast-handlers";
import { I18nKey } from "#/i18n/declaration";
import { Typography } from "#/ui/typography";
import { cn } from "#/utils/utils";
import {
  settingsListContainerClassName,
  settingsListDividerClassName,
} from "#/utils/settings-list-classes";
import { extensionModuleEmptyStateClassName } from "#/utils/extension-module-card-classes";

interface AgentRuntimeProfilesManagerProps {
  onAddProfile?: () => void;
  onEditProfile?: (profile: AgentProfileSummary) => void;
}

/**
 * The agent-runtime section of the LLM-profiles page: a named runtime plus the
 * model it runs, so "Codex on gpt-5.5-codex" is a profile a user can save and
 * pick, not something only Settings → Agents can express.
 *
 * These are `agent_kind: "acp"` agent profiles — the same `/api/agent-profiles`
 * records Settings → Agents manages, listed here as a second view rather than
 * copied into a parallel store. They stay a separate list from the API-key
 * profiles above because most places that take an LLM profile need a model a
 * key can call directly (conversation titles, the model router's classifier, an
 * OpenHands agent's own LLM); a runtime cannot serve those.
 */
export function AgentRuntimeProfilesManager({
  onAddProfile,
  onEditProfile,
}: AgentRuntimeProfilesManagerProps) {
  const { t } = useTranslation("openhands");
  const { entries, isLoading, error } = useAgentRuntimeProfiles();
  const { data: agentProfilesData } = useAgentProfiles();
  const activateProfile = useActivateAgentProfile();
  const canManage = useCanManageOrgProfiles();
  const [profileToDelete, setProfileToDelete] =
    useState<AgentProfileSummary | null>(null);

  const activeId = agentProfilesData?.active_agent_profile_id ?? null;

  const handleActivate = async (profile: AgentProfileSummary) => {
    if (!profile.id) return;
    try {
      await activateProfile.mutateAsync(profile.id);
      displaySuccessToast(
        t(I18nKey.SETTINGS$PROFILE_ACTIVATED, { name: profile.name }),
      );
    } catch (activateError) {
      // The global mutation error toast reports the failure; just log here.
      console.error("Failed to activate agent runtime profile:", activateError);
    }
  };

  const body = (() => {
    if (isLoading) {
      return (
        <div
          data-testid="agent-runtime-profiles-loading"
          className="flex justify-center p-4"
        >
          <LoadingSpinner size="large" />
        </div>
      );
    }
    if (error) {
      return (
        <div
          data-testid="agent-runtime-profiles-load-error"
          className={extensionModuleEmptyStateClassName}
        >
          <p className="text-sm text-feedback-error">
            {t(I18nKey.SETTINGS$PROFILES_LOAD_ERROR)}
          </p>
        </div>
      );
    }
    if (entries.length === 0) {
      return (
        <div
          data-testid="agent-runtime-profiles-empty"
          className={extensionModuleEmptyStateClassName}
        >
          <p className="text-sm text-muted">
            {t(I18nKey.SETTINGS$RUNTIME_PROFILES_EMPTY)}
          </p>
        </div>
      );
    }
    return (
      <div
        className={cn(
          settingsListContainerClassName,
          settingsListDividerClassName,
        )}
      >
        {entries.map((entry) => (
          <AgentRuntimeProfileRow
            key={entry.summary.name}
            entry={entry}
            isActive={!!entry.summary.id && entry.summary.id === activeId}
            canManage={canManage}
            onActivate={handleActivate}
            onEdit={(profile) => onEditProfile?.(profile)}
            onDelete={setProfileToDelete}
            isActivating={activateProfile.isPending}
          />
        ))}
      </div>
    );
  })();

  return (
    <>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="text-base font-medium text-contrast">
              {t(I18nKey.SETTINGS$RUNTIME_PROFILES)}
            </h2>
            <Typography.Text className="text-sm text-tertiary-light">
              {t(I18nKey.SETTINGS$RUNTIME_PROFILES_DESCRIPTION)}
            </Typography.Text>
          </div>
          {onAddProfile && canManage ? (
            <BrandButton
              testId="add-agent-runtime-profile"
              type="button"
              variant="secondary"
              className="ml-auto"
              onClick={onAddProfile}
            >
              {t(I18nKey.SETTINGS$ADD_RUNTIME_PROFILE)}
            </BrandButton>
          ) : null}
        </div>
        {body}
      </div>

      <DeleteAgentProfileModal
        profile={profileToDelete}
        onClose={() => setProfileToDelete(null)}
      />
    </>
  );
}
