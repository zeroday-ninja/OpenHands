/**
 * Which repository the map is a picture of.
 *
 * The page used to answer that question silently: it read the backend's own
 * working directory, which on a development stack is a folder of automation
 * runs, and the person looking at an empty map of it had no way to know that
 * and no way to change it. This is the control that was missing. It is the
 * same saved-workspaces list, folder browser and manage dialog the home page
 * uses to attach a folder to a conversation, so a repository added in either
 * place is known in both.
 *
 * Deliberately not gated on `useConversationWorkspace().unsupportedMessage`.
 * That message says host folders cannot be attached on a Docker backend, and
 * the Docker runtime mounts them; the page that reads this choice starts its
 * conversations with the folder as their working directory, which is what
 * puts the repository inside the sandbox.
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import { FolderBrowserModal } from "#/components/features/home/workspace-dropdown/folder-browser-modal";
import { ManageWorkspacesModal } from "#/components/features/home/workspace-dropdown/manage-workspaces-modal";
import { WorkspaceDropdown } from "#/components/features/home/workspace-dropdown/workspace-dropdown";
import {
  useAddWorkspaceParents,
  useAddWorkspaces,
  useRemoveWorkspace,
  useRemoveWorkspaceParent,
} from "#/hooks/mutation/use-local-workspaces-mutations";
import { useLocalWorkspaces } from "#/hooks/query/use-local-workspaces";
import { useResolvedWorkspaces } from "#/hooks/query/use-resolved-workspaces";
import type { LocalWorkspace } from "#/types/workspace";
import { getWorkspacesUnsupportedMessage } from "#/utils/workspaces-compatibility";
import { PROJECT_MAP_SECTION_LABEL_CLASS } from "./project-map-controls";

export interface ProjectMapWorkspacePickerProps {
  /** Absolute path of the chosen folder, or null for the backend's own directory. */
  value: string | null;
  onChange: (path: string | null) => void;
  /** Whether to spell out what the choice is for, as the empty state does. */
  hint?: boolean;
}

/** The last path segment, which is what a person calls a repository. */
function basename(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return index === -1 ? trimmed : trimmed.slice(index + 1) || trimmed;
}

export function ProjectMapWorkspacePicker({
  value,
  onChange,
  hint = false,
}: ProjectMapWorkspacePickerProps) {
  const { t } = useTranslation("openhands");
  const { data: workspacesData, error: workspacesError } = useLocalWorkspaces();
  const workspaceParents = workspacesData?.workspaceParents ?? [];
  const {
    workspaces,
    parents,
    isLoading,
    isError,
    error: resolvedError,
  } = useResolvedWorkspaces();
  const { mutate: addWorkspaces } = useAddWorkspaces();
  const { mutate: removeWorkspace } = useRemoveWorkspace();
  const { mutate: addWorkspaceParents } = useAddWorkspaceParents();
  const { mutate: removeWorkspaceParent } = useRemoveWorkspaceParent();
  const [browserOpen, setBrowserOpen] = React.useState(false);
  const [manageOpen, setManageOpen] = React.useState(false);

  const unsupportedMessage = getWorkspacesUnsupportedMessage(
    workspacesError ?? resolvedError,
    t,
  );

  // The chosen folder is shown even when the list no longer has it — removed
  // from the saved workspaces, or saved on another visit — because the page is
  // reading it, and a control that shows nothing while the page reads
  // something is the mystery this exists to end. Clearing it is still offered.
  const selected = React.useMemo<LocalWorkspace | null>(() => {
    if (value === null) return null;
    return (
      workspaces.find((workspace) => workspace.path === value) ?? {
        id: value,
        name: basename(value),
        path: value,
      }
    );
  }, [value, workspaces]);

  let status: string | null = null;
  if (unsupportedMessage) status = unsupportedMessage;
  else if (isLoading && workspaces.length === 0)
    status = t(I18nKey.HOME$LOADING);
  else if (isError) status = t(I18nKey.HOME$WORKSPACE_SCAN_ERROR);

  return (
    <div
      data-testid="project-map-workspace-picker"
      data-path={value ?? undefined}
      className="flex w-full max-w-md flex-col gap-1.5"
    >
      <span className={PROJECT_MAP_SECTION_LABEL_CLASS}>
        {t(I18nKey.PROJECT_MAP$WORKSPACE_PICKER_LABEL)}
      </span>
      {hint && (
        <p className="text-sm leading-relaxed text-text-secondary">
          {t(I18nKey.PROJECT_MAP$WORKSPACE_PICKER_HINT)}
        </p>
      )}
      <WorkspaceDropdown
        workspaces={workspaces}
        parents={parents}
        value={selected}
        placeholder={
          unsupportedMessage
            ? t(I18nKey.HOME$WORKSPACES_UNSUPPORTED_PLACEHOLDER)
            : t(I18nKey.PROJECT_MAP$WORKSPACE_PICKER_PLACEHOLDER)
        }
        disabled={Boolean(unsupportedMessage)}
        disabledTooltip={unsupportedMessage}
        showManage={workspaces.length > 0 || workspaceParents.length > 0}
        onChange={(workspace) => onChange(workspace?.path ?? null)}
        onAddClick={() => setBrowserOpen(true)}
        onManageClick={() => setManageOpen(true)}
        // Downshift keeps its own input text; remounting on a new value is how
        // the home form shows a selection made elsewhere, and it is how this
        // one shows the remembered folder on the first render.
        key={selected?.path ?? "no-workspace"}
      />
      {status && (
        <p
          data-testid="project-map-workspace-status"
          className="text-xs text-text-secondary"
        >
          {status}
        </p>
      )}

      <FolderBrowserModal
        isOpen={browserOpen}
        onClose={() => setBrowserOpen(false)}
        onAdd={(items) => {
          // The folder just added is the one they want to look at: choosing
          // it for them is the difference between one step and two.
          const lastAdded = items[items.length - 1];
          addWorkspaces(items, {
            onSuccess: () => {
              if (lastAdded) onChange(lastAdded.path);
            },
          });
        }}
        onAddParent={(items) => addWorkspaceParents(items)}
      />
      <ManageWorkspacesModal
        isOpen={manageOpen}
        workspaces={workspaces}
        workspaceParents={workspaceParents}
        onClose={() => setManageOpen(false)}
        onRemove={(path) => {
          removeWorkspace(path);
          // A folder that is no longer saved is still on disk, and the page
          // is still reading it; nothing else changes until they choose.
        }}
        onRemoveParent={(path) => removeWorkspaceParent(path)}
      />
    </div>
  );
}
