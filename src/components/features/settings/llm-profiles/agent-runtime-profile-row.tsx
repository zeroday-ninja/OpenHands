import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AgentProfileActionsMenu } from "#/components/features/settings/agent-profiles/agent-profile-actions-menu";
import {
  WELL_KNOWN_DEFAULT_AGENT_PROFILE_NAME,
  type AgentProfileSummary,
} from "#/api/agent-profiles-service/agent-profiles-service.api";
import type { AgentRuntimeProfileEntry } from "#/hooks/query/use-agent-runtime-profiles";
import { useActiveBackend } from "#/contexts/active-backend-context";
import {
  ACP_CUSTOM_PRESET_KEY,
  getAcpProviderDisplayName,
  labelForAcpModel,
} from "#/constants/acp-providers";
import { I18nKey } from "#/i18n/declaration";
import { EllipsisButton } from "#/components/features/conversation-panel/ellipsis-button";
import { BrandBadge } from "#/components/shared/badge";
import { cn } from "#/utils/utils";
import { extensionModuleCardPillClassName } from "#/utils/extension-module-card-classes";
import {
  settingsListIconActionButtonClassName,
  settingsListRowClassName,
} from "#/utils/settings-list-classes";

interface AgentRuntimeProfileRowProps {
  entry: AgentRuntimeProfileEntry;
  isActive: boolean;
  /** When false the row is read-only (cloud members). */
  canManage: boolean;
  onActivate: (profile: AgentProfileSummary) => void;
  onEdit: (profile: AgentProfileSummary) => void;
  onDelete: (profile: AgentProfileSummary) => void;
  isActivating: boolean;
}

/**
 * One agent-runtime profile in the LLM-profiles page. Carries a "Runtime"
 * marker because these fail and bill unlike an API-key profile: the model runs
 * through the runtime's own CLI and sign-in, so there is no key on the profile
 * and no provider connection behind it.
 */
export function AgentRuntimeProfileRow({
  entry,
  isActive,
  canManage,
  onActivate,
  onEdit,
  onDelete,
  isActivating,
}: AgentRuntimeProfileRowProps) {
  const { t } = useTranslation("openhands");
  const { backend } = useActiveBackend();
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { summary, detail } = entry;
  // The server reseeds a deleted local `default`, which would reset what it
  // shares with the global settings pages.
  const isProtected =
    backend.kind === "local" &&
    summary.name === WELL_KNOWN_DEFAULT_AGENT_PROFILE_NAME;

  const runtimeLabel = (() => {
    if (!detail) return null;
    if (detail.acp_server === ACP_CUSTOM_PRESET_KEY) {
      return t(I18nKey.SETTINGS$RUNTIME_PROFILE_CUSTOM_COMMAND);
    }
    return getAcpProviderDisplayName(detail.acp_server) ?? detail.acp_server;
  })();
  // No stored model means the runtime picks its own, which is a real choice
  // and not a missing value — name it rather than leaving the cell blank.
  const modelLabel = detail
    ? (labelForAcpModel(detail.acp_model) ??
      t(I18nKey.SETTINGS$RUNTIME_PROFILE_RUNTIME_DEFAULT_MODEL))
    : null;

  return (
    <div
      data-testid="agent-runtime-profile-row"
      className={cn(settingsListRowClassName, "justify-between gap-3")}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span
          className="min-w-0 max-w-full truncate text-sm font-medium text-contrast"
          title={summary.name}
        >
          {summary.name}
        </span>
        <span
          data-testid="agent-runtime-profile-badge"
          className={extensionModuleCardPillClassName}
        >
          {t(I18nKey.SETTINGS$RUNTIME_PROFILE_BADGE)}
        </span>
        {runtimeLabel ? (
          <span
            data-testid="agent-runtime-profile-runtime"
            className="min-w-0 max-w-full truncate text-sm text-contrast"
            title={runtimeLabel}
          >
            {runtimeLabel}
          </span>
        ) : null}
        {modelLabel ? (
          <span
            data-testid="agent-runtime-profile-model"
            className="min-w-0 max-w-full truncate text-sm text-muted"
            title={modelLabel}
          >
            {modelLabel}
          </span>
        ) : null}
        {isActive && (
          <BrandBadge
            className="shrink-0 whitespace-nowrap px-2.5 py-1 text-xs"
            data-testid="agent-runtime-profile-active-badge"
          >
            {t(I18nKey.SETTINGS$PROFILE_ACTIVE)}
          </BrandBadge>
        )}
      </div>
      {canManage && (
        <div className="relative shrink-0">
          <EllipsisButton
            ref={triggerRef}
            onClick={() => setMenuOpen((open) => !open)}
            ariaLabel={t(I18nKey.SETTINGS$PROFILE_MENU)}
            testId="agent-runtime-profile-menu-trigger"
            className={settingsListIconActionButtonClassName}
          />
          {menuOpen && (
            <AgentProfileActionsMenu
              anchorRef={triggerRef}
              onEdit={() => onEdit(summary)}
              onSetActive={() => onActivate(summary)}
              onDelete={() => onDelete(summary)}
              deleteDisabledReason={
                isProtected
                  ? t(I18nKey.SETTINGS$AGENT_PROFILE_DEFAULT_LOCKED)
                  : undefined
              }
              isActive={isActive}
              isActivating={isActivating}
              onClose={() => setMenuOpen(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}
