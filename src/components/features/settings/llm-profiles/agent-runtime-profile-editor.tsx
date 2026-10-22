import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ProfileNameInput } from "./profile-name-input";
import {
  buildRuntimeProfileEdits,
  deriveRuntimeProfileName,
  runtimeProfileDraft,
  type RuntimeProfileDraft,
} from "./agent-runtime-profile-form";
import { BrandButton } from "#/components/features/settings/brand-button";
import { SettingsDropdownInput } from "#/components/features/settings/settings-dropdown-input";
import { SettingsInput } from "#/components/features/settings/settings-input";
import { BackNavButton } from "#/components/shared/buttons/back-nav-button";
import { mergeAgentProfileSaveInput } from "#/components/features/settings/agent-profiles/merge-agent-profile-save-input";
import type {
  AgentProfileSummary,
  StoredAcpProfile,
} from "#/api/agent-profiles-service/agent-profiles-service.api";
import { useActiveBackend } from "#/contexts/active-backend-context";
import { useSaveAgentProfile } from "#/hooks/mutation/use-save-agent-profile";
import { useRenameAgentProfile } from "#/hooks/mutation/use-rename-agent-profile";
import { useAgentProfiles } from "#/hooks/query/use-agent-profiles";
import { useAcpModelDiscovery } from "#/hooks/query/use-acp-model-discovery";
import type { ACPServerKind } from "@openhands/typescript-client";
import {
  ACP_CUSTOM_PRESET_KEY,
  getAcpPreferredDefaultModel,
  getAcpProvidersForBackend,
  labelForAcpModel,
  type ACPModelOption,
} from "#/constants/acp-providers";
import { acpEffortLabel, selectableAcpEfforts } from "#/utils/acp-model-effort";
import { I18nKey } from "#/i18n/declaration";
import { Typography } from "#/ui/typography";
import { getApiErrorMessage } from "#/utils/api-error-message";
import {
  displayErrorToast,
  displaySuccessToast,
} from "#/utils/custom-toast-handlers";
import { isProfileNameValid } from "#/utils/derive-profile-name";

/** Dropdown sentinels, which cannot collide with a real model or effort id. */
const RUNTIME_DEFAULT_MODEL_KEY = "__runtime_default_model__";
const CUSTOM_MODEL_KEY = "__custom_model__";
const RUNTIME_DEFAULT_EFFORT_KEY = "__runtime_default_effort__";

/** `models` plus `selected`, so a saved model the agent no longer lists stays. */
function withSelectedModel(
  models: readonly ACPModelOption[],
  selected: string,
): ACPModelOption[] {
  const id = selected.trim();
  if (!id || models.some((model) => model.id === id)) return [...models];
  return [...models, { id, label: id }];
}

interface AgentRuntimeProfileEditorProps {
  /** The profile being edited, or null when creating one. */
  stored: StoredAcpProfile | null;
  /** Summary of the profile being edited; null when creating one. */
  summary: AgentProfileSummary | null;
  onClose: () => void;
}

/**
 * Create or edit an agent-runtime profile from the LLM-profiles page: pick the
 * runtime, pick or type its model, pick the reasoning effort.
 *
 * The runtime and effort travel to the agent-server as one `acp_model` id, and
 * this form is the only thing that composes it, so the user never types the
 * `<model>/<effort>` form. Every other field on the underlying agent profile —
 * launch command, session mode, timeouts, MCP and secret scope, usage-limit
 * failover — belongs to Settings → Agents and is carried through the save
 * untouched by `mergeAgentProfileSaveInput`.
 */
export function AgentRuntimeProfileEditor({
  stored,
  summary,
  onClose,
}: AgentRuntimeProfileEditorProps) {
  const { t } = useTranslation("openhands");
  const { backend } = useActiveBackend();
  const runtimes = useMemo(
    () => getAcpProvidersForBackend(backend.kind),
    [backend.kind],
  );
  const saveProfile = useSaveAgentProfile();
  const renameProfile = useRenameAgentProfile();
  const { data: agentProfilesData } = useAgentProfiles();

  const [draft, setDraft] = useState<RuntimeProfileDraft>(() =>
    // The registry's keys are the ACP provider keys; it just types them wider.
    runtimeProfileDraft(
      stored,
      (runtimes[0]?.key as ACPServerKind | undefined) ?? ACP_CUSTOM_PRESET_KEY,
    ),
  );
  const [name, setName] = useState(() => summary?.name ?? "");
  const [isNameUserEdited, setIsNameUserEdited] = useState(!!summary);
  // The saved model is always injected into the option list, so an edit opens
  // on the dropdown; "Custom" is a deliberate choice the user makes.
  const [isCustomModel, setIsCustomModel] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const isCustomRuntime = draft.server === ACP_CUSTOM_PRESET_KEY;
  const discovery = useAcpModelDiscovery(
    isCustomRuntime ? null : draft.server,
    { secretRefs: stored?.secret_refs ?? null },
  );
  // A custom command's models are whatever its own wrapper accepts, so there is
  // nothing to discover and nothing to list: it is a free-text model only.
  const models = isCustomRuntime
    ? []
    : withSelectedModel(discovery.models, isCustomModel ? "" : draft.modelId);
  const efforts = (modelId: string) =>
    selectableAcpEfforts(models.find((m) => m.id === modelId)?.efforts);

  // A runtime whose own default is unsafe (Gemini on Vertex) must always name a
  // model, so it neither offers nor accepts the "runtime default" choice.
  const requiresModel =
    !isCustomRuntime && !!getAcpPreferredDefaultModel(draft.server);
  const offersRuntimeDefault = !isCustomRuntime && !requiresModel;
  // With nothing to choose between, the model is a plain field rather than a
  // dropdown plus a second field repeating its label.
  const showModelSelector = models.length > 0 || offersRuntimeDefault;
  let selectedModelKey: string;
  if (isCustomModel || isCustomRuntime) {
    selectedModelKey = CUSTOM_MODEL_KEY;
  } else if (!draft.modelId.trim() && offersRuntimeDefault) {
    selectedModelKey = RUNTIME_DEFAULT_MODEL_KEY;
  } else {
    selectedModelKey = draft.modelId;
  }
  const selectedEfforts =
    selectedModelKey === CUSTOM_MODEL_KEY ||
    selectedModelKey === RUNTIME_DEFAULT_MODEL_KEY
      ? []
      : efforts(selectedModelKey);

  // Keep the auto-derived name following the runtime/model until the user
  // types their own, and never auto-fill a name another profile already uses.
  const takenNames = useMemo(
    () =>
      new Set(
        (agentProfilesData?.profiles ?? [])
          .map((profile) => profile.name)
          .filter((taken) => taken !== summary?.name),
      ),
    [agentProfilesData, summary?.name],
  );
  const updateDraft = (next: RuntimeProfileDraft) => {
    setDraft(next);
    if (isNameUserEdited) return;
    const derived = deriveRuntimeProfileName(next);
    setName(takenNames.has(derived) ? "" : derived);
  };

  const isNameFormatValid = isProfileNameValid(name, { isRequired: true });
  const isDuplicateName = isNameFormatValid && takenNames.has(name);
  const isNameValid = isNameFormatValid && !isDuplicateName;
  // A runtime with no safe default of its own cannot be saved without a model.
  const isModelValid = !requiresModel || !!draft.modelId.trim();

  const handleSave = async () => {
    if (!isNameValid || !isModelValid) return;
    const trimmedName = name.trim();
    const originalName = summary?.name;
    setIsSaving(true);
    try {
      // Rename first so the save lands on the new name while the server keeps
      // the profile's id — and with it the active pointer.
      if (originalName && originalName !== trimmedName) {
        await renameProfile.mutateAsync({
          name: originalName,
          newName: trimmedName,
        });
      }
      await saveProfile.mutateAsync({
        name: trimmedName,
        profile: mergeAgentProfileSaveInput(
          stored,
          buildRuntimeProfileEdits(stored, draft),
        ),
      });
      displaySuccessToast(
        stored
          ? t(I18nKey.SETTINGS$PROFILE_UPDATED, { name: trimmedName })
          : t(I18nKey.SETTINGS$PROFILE_CREATED, { name: trimmedName }),
      );
      onClose();
    } catch (error) {
      displayErrorToast(getApiErrorMessage(error, t(I18nKey.ERROR$GENERIC)));
    } finally {
      setIsSaving(false);
    }
  };

  const runtimeDefaultModelLabel = labelForAcpModel(
    discovery.defaultModelId,
    discovery.models,
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <BackNavButton testId="back-to-runtime-profiles" onClick={onClose}>
          {t(I18nKey.BUTTON$BACK)}
        </BackNavButton>
        <Typography.H2 testId="runtime-profile-editor-title">
          {stored
            ? t(I18nKey.SETTINGS$EDIT_RUNTIME_PROFILE)
            : t(I18nKey.SETTINGS$ADD_RUNTIME_PROFILE)}
        </Typography.H2>
        <p
          data-testid="runtime-profile-editor-description"
          className="text-sm leading-5 text-tertiary-light"
        >
          {t(I18nKey.SETTINGS$RUNTIME_PROFILE_SAVE_HINT)}
        </p>
      </div>

      <ProfileNameInput
        testId="runtime-profile-name-input"
        value={name}
        onChange={(value) => {
          setName(value);
          setIsNameUserEdited(value !== "");
        }}
        isRequired
        error={
          isDuplicateName
            ? t(I18nKey.SETTINGS$LLM_PROFILE_NAME_TAKEN)
            : undefined
        }
      />

      <SettingsDropdownInput
        testId="runtime-profile-runtime-selector"
        name="runtime-profile-runtime"
        label={t(I18nKey.SETTINGS$RUNTIME_PROFILE_RUNTIME)}
        items={[
          ...runtimes.map((runtime) => ({
            key: runtime.key,
            label: runtime.display_name,
          })),
          // Only offered to keep an Agents-owned custom-command profile
          // selectable; this form cannot create one.
          ...(isCustomRuntime
            ? [
                {
                  key: ACP_CUSTOM_PRESET_KEY,
                  label: t(I18nKey.SETTINGS$RUNTIME_PROFILE_CUSTOM_COMMAND),
                },
              ]
            : []),
        ]}
        selectedKey={draft.server}
        onSelectionChange={(key) => {
          if (!key) return;
          const server = String(key) as ACPServerKind;
          if (server === draft.server) return;
          // The previous runtime's model means nothing to the new one, so start
          // it on whatever model the new runtime needs (none, unless its own
          // default is unsafe).
          setIsCustomModel(false);
          updateDraft({
            server,
            modelId: getAcpPreferredDefaultModel(server) ?? "",
            effort: null,
          });
        }}
      />

      <div className="flex flex-col gap-1.5">
        {showModelSelector ? (
          <SettingsDropdownInput
            testId="runtime-profile-model-selector"
            name="runtime-profile-model"
            label={t(I18nKey.SETTINGS$AGENT_MODEL)}
            isLoading={discovery.isDiscovering}
            items={[
              ...(offersRuntimeDefault
                ? [
                    {
                      key: RUNTIME_DEFAULT_MODEL_KEY,
                      label: runtimeDefaultModelLabel
                        ? t(I18nKey.SETTINGS$AGENT_MODEL_AGENT_DEFAULT_IS, {
                            model: runtimeDefaultModelLabel,
                          })
                        : t(I18nKey.SETTINGS$AGENT_MODEL_AGENT_DEFAULT),
                    },
                  ]
                : []),
              ...models.map((model) => ({ key: model.id, label: model.label })),
              {
                key: CUSTOM_MODEL_KEY,
                label: t(I18nKey.SETTINGS$AGENT_PRESET_CUSTOM),
              },
            ]}
            selectedKey={selectedModelKey}
            onSelectionChange={(key) => {
              if (!key) return;
              const modelKey = String(key);
              if (modelKey === CUSTOM_MODEL_KEY) {
                setIsCustomModel(true);
                updateDraft({ ...draft, modelId: "", effort: null });
                return;
              }
              setIsCustomModel(false);
              if (modelKey === RUNTIME_DEFAULT_MODEL_KEY) {
                updateDraft({ ...draft, modelId: "", effort: null });
                return;
              }
              // Keep the chosen effort only where the new model offers it.
              const effort =
                draft.effort && efforts(modelKey).includes(draft.effort)
                  ? draft.effort
                  : null;
              updateDraft({ ...draft, modelId: modelKey, effort });
            }}
          />
        ) : null}

        {selectedModelKey === CUSTOM_MODEL_KEY ? (
          <SettingsInput
            testId="runtime-profile-model-input"
            name="runtime-profile-custom-model"
            label={
              showModelSelector
                ? t(I18nKey.SETTINGS$AGENT_CUSTOM_MODEL)
                : t(I18nKey.SETTINGS$AGENT_MODEL)
            }
            type="text"
            className="w-full"
            value={draft.modelId}
            onChange={(value) => updateDraft({ ...draft, modelId: value })}
          />
        ) : null}

        {selectedEfforts.length > 0 ? (
          <SettingsDropdownInput
            testId="runtime-profile-effort-selector"
            name="runtime-profile-effort"
            label={t(I18nKey.MODEL$EFFORT)}
            items={[
              {
                key: RUNTIME_DEFAULT_EFFORT_KEY,
                label: t(I18nKey.SETTINGS$AGENT_MODEL_AGENT_DEFAULT),
              },
              ...selectedEfforts.map((effort) => ({
                key: effort,
                label: acpEffortLabel(effort),
              })),
            ]}
            selectedKey={draft.effort ?? RUNTIME_DEFAULT_EFFORT_KEY}
            onSelectionChange={(key) => {
              if (!key) return;
              const effortKey = String(key);
              updateDraft({
                ...draft,
                effort:
                  effortKey === RUNTIME_DEFAULT_EFFORT_KEY ? null : effortKey,
              });
            }}
          />
        ) : null}

        <Typography.Text className="text-xs text-tertiary-light">
          {t(I18nKey.SETTINGS$RUNTIME_PROFILE_CREDENTIALS_HINT)}
        </Typography.Text>
      </div>

      <div className="flex justify-start gap-3 pt-4">
        <BrandButton
          testId="cancel-runtime-profile-btn"
          type="button"
          variant="secondary"
          onClick={onClose}
        >
          {t(I18nKey.BUTTON$CANCEL)}
        </BrandButton>
        <BrandButton
          testId="save-runtime-profile-btn"
          type="button"
          variant="primary"
          onClick={handleSave}
          isDisabled={!isNameValid || !isModelValid || isSaving}
          aria-busy={isSaving}
        >
          {isSaving ? t(I18nKey.STATUS$SAVING) : t(I18nKey.BUTTON$SAVE)}
        </BrandButton>
      </div>
    </div>
  );
}
