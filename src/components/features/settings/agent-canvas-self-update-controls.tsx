import { useTranslation } from "react-i18next";
import { ArrowUpCircle, Loader2, RefreshCw } from "lucide-react";
import type { AgentCanvasSelfUpdateMethod } from "#/api/agent-canvas-updates";
import { BrandButton } from "#/components/features/settings/brand-button";
import { useAgentCanvasControl } from "#/hooks/query/use-agent-canvas-control";
import {
  useAgentCanvasSelfUpdate,
  type AgentCanvasSelfUpdateState,
} from "#/hooks/use-agent-canvas-self-update";
import { I18nKey } from "#/i18n/declaration";
import { cn } from "#/utils/utils";

function methodHintKey(method: AgentCanvasSelfUpdateMethod | null): I18nKey {
  switch (method) {
    case "git-checkout":
      return I18nKey.SETTINGS$VERSION_UPDATE_METHOD_GIT;
    case "npx":
      return I18nKey.SETTINGS$VERSION_UPDATE_METHOD_NPX;
    default:
      return I18nKey.SETTINGS$VERSION_UPDATE_METHOD_NPM;
  }
}

function progressKey(state: AgentCanvasSelfUpdateState): I18nKey | null {
  switch (state.phase) {
    case "requesting":
    case "updating":
      return state.phase === "updating" || state.action === "update"
        ? I18nKey.SETTINGS$VERSION_UPDATE_PROGRESS_UPDATING
        : I18nKey.SETTINGS$VERSION_UPDATE_PROGRESS_RESTARTING;
    case "restarting":
      return I18nKey.SETTINGS$VERSION_UPDATE_PROGRESS_RESTARTING;
    case "reloading":
      return I18nKey.SETTINGS$VERSION_UPDATE_PROGRESS_RELOADING;
    default:
      return null;
  }
}

interface AgentCanvasSelfUpdateControlsProps {
  /** Offer "Update and restart"; otherwise only a restart. */
  updateAvailable: boolean;
  /** The release the npm check reported, which the update should reach. */
  latestVersion?: string | null;
  className?: string;
}

/**
 * One-click update and restart of the local stack, shown instead of the
 * copy-a-command instructions when the launcher serving this page supports
 * it (see `useAgentCanvasControl`). Renders nothing otherwise, so callers can
 * fall back to the commands.
 */
export function AgentCanvasSelfUpdateControls({
  updateAvailable,
  latestVersion = null,
  className,
}: AgentCanvasSelfUpdateControlsProps) {
  const { t } = useTranslation("openhands");
  const control = useAgentCanvasControl();
  const { state, start } = useAgentCanvasSelfUpdate(control.data ?? null, {
    targetVersion: latestVersion,
  });
  const info = control.data?.info;
  if (!info?.enabled) return null;
  const canUpdate = updateAvailable && info.self_update.supported;
  const canRestart = info.restart.supported;
  if (!canUpdate && !canRestart) return null;

  const busy = state.phase !== "idle" && state.phase !== "failed";
  const progress = progressKey(state);

  return (
    <div
      className={cn("flex w-full flex-col gap-2", className)}
      data-testid="agent-canvas-self-update"
    >
      <div className="flex flex-wrap items-center gap-2">
        {canUpdate ? (
          <BrandButton
            testId="agent-canvas-self-update-button"
            type="button"
            variant="primary"
            isDisabled={busy}
            aria-busy={busy}
            onClick={() => void start("update")}
            startContent={
              busy && state.action === "update" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <ArrowUpCircle className="size-4" aria-hidden />
              )
            }
          >
            {t(I18nKey.SETTINGS$VERSION_UPDATE_NOW)}
          </BrandButton>
        ) : null}
        {canRestart ? (
          <BrandButton
            testId="agent-canvas-restart-button"
            type="button"
            variant={canUpdate ? "secondary" : "primary"}
            isDisabled={busy}
            aria-busy={busy}
            onClick={() => void start("restart")}
            startContent={
              busy && state.action === "restart" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="size-4" aria-hidden />
              )
            }
          >
            {t(I18nKey.SETTINGS$VERSION_RESTART_NOW)}
          </BrandButton>
        ) : null}
      </div>
      {canUpdate && !busy && state.phase !== "failed" ? (
        <p className="text-xs text-muted">
          {t(methodHintKey(info.self_update.method), {
            version: latestVersion ?? "",
          })}
        </p>
      ) : null}
      {progress ? (
        <p
          className="text-xs text-contrast"
          data-testid="agent-canvas-self-update-status"
          role="status"
        >
          {t(progress)}
          {state.phase === "updating" && state.message ? (
            <span className="block truncate text-muted">{state.message}</span>
          ) : null}
        </p>
      ) : null}
      {state.phase === "failed" ? (
        <p
          className="whitespace-pre-wrap text-xs text-status-error"
          data-testid="agent-canvas-self-update-error"
          role="alert"
        >
          {t(I18nKey.SETTINGS$VERSION_UPDATE_FAILED, { message: state.error })}
        </p>
      ) : null}
    </div>
  );
}
