import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Cog } from "lucide-react";
import { I18nKey } from "#/i18n/declaration";
import { BrandButton } from "#/components/features/settings/brand-button";
import { SettingsInput } from "#/components/features/settings/settings-input";
import { SettingsSwitch } from "#/components/features/settings/settings-switch";
import { SectionCard } from "#/components/features/automations/detail/section-card";
import { useReplaceImproveConfig } from "#/hooks/mutation/use-replace-improve-config";
import { useGitSyncRemotes } from "#/hooks/query/use-git-sync";
import {
  useImproveProfileOptions,
  type ImproveProfileOption,
} from "#/hooks/query/use-improve-profile-options";
import type { ImproveProgramConfig } from "#/types/improve";
import { getApiErrorMessage } from "#/utils/api-error-message";
import { displaySuccessToast } from "#/utils/custom-toast-handlers";
import {
  formControlMultilineFieldClassName,
  formControlSettingsFieldClassName,
} from "#/utils/form-control-classes";
import { remoteDisplayName } from "#/utils/git-sync-repo-url";
import {
  hasImproveConfigFormErrors,
  improveConfigFormErrors,
  improveConfigFormState,
  improveConfigFromForm,
  MAX_IMPROVE_BUILDERS,
  MAX_IMPROVE_REPOSITORIES,
  MAX_IMPROVE_REVIEWERS,
  MAX_IMPROVE_CHANGED_FILES,
  MIN_IMPROVE_CHANGED_FILES,
  type ImproveConfigFormState,
  type ImproveRepositoryRow,
} from "#/utils/improve-program-config";
import { cn } from "#/utils/utils";

const EMPTY_ROW: ImproveRepositoryRow = { label: "", url: "", ref: "" };

/** A profile named with the runtime it runs, which is the part that matters. */
function profileLabel(option: ImproveProfileOption): string {
  return option.runtime ? `${option.name} (${option.runtime})` : option.name;
}

function FieldGroup({
  legend,
  help,
  children,
  testId,
}: {
  legend: string;
  help?: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <fieldset data-testid={testId} className="flex flex-col gap-2">
      <legend className="text-sm text-content">{legend}</legend>
      {help ? <p className="text-xs text-muted">{help}</p> : null}
      {children}
    </fieldset>
  );
}

/** A checkbox list over agent profiles, capped the way the service caps it. */
function ProfileChecklist({
  testId,
  options,
  selected,
  max,
  isDisabled,
  onChange,
}: {
  testId: string;
  options: ImproveProfileOption[];
  selected: string[];
  max: number;
  isDisabled?: boolean;
  onChange: (next: string[]) => void;
}) {
  const { t } = useTranslation("openhands");
  const atCap = selected.length >= max;

  return (
    <div className="flex flex-col gap-1.5">
      {options.map((option) => {
        const isSelected = selected.includes(option.id);
        return (
          <label
            key={option.id}
            className={cn(
              "flex items-center gap-2 text-sm text-content",
              isDisabled && "opacity-50",
            )}
          >
            <input
              type="checkbox"
              data-testid={testId}
              data-profile-id={option.id}
              checked={isSelected}
              disabled={isDisabled || (atCap && !isSelected)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, option.id]
                    : selected.filter((id) => id !== option.id),
                )
              }
            />
            {profileLabel(option)}
          </label>
        );
      })}
      {atCap ? (
        <p className="text-xs text-muted">
          {t(I18nKey.AUTOMATIONS$IMPROVE$CONFIG_MAX_SELECTED, {
            limit: String(max),
          })}
        </p>
      ) : null}
    </div>
  );
}

interface ImproveConfigFormProps {
  automationId: string;
  config: ImproveProgramConfig;
}

/**
 * Everything an improvement program is, editable in one place.
 *
 * The generic automation editor can only reach a program's name, schedule and
 * timeout; which profile builds, which runtimes review, what it rotates over
 * and what it is told to focus on live here, because this is the only form
 * that speaks `ImproveProgramConfig`.
 */
export function ImproveConfigForm({
  automationId,
  config,
}: ImproveConfigFormProps) {
  const { t } = useTranslation("openhands");
  // Seeded from the stored configuration and owned by the form from then on.
  // Remounted by `key` when the automation changes, so a saved response does
  // not have to be reconciled back into draft state.
  const [state, setState] = useState<ImproveConfigFormState>(() =>
    improveConfigFormState(config),
  );
  const [failure, setFailure] = useState<string | null>(null);

  const profiles = useImproveProfileOptions();
  const remotes = useGitSyncRemotes({
    enabled: state.repositorySource === "git_sync",
  });
  const save = useReplaceImproveConfig(automationId);

  const patch = (next: Partial<ImproveConfigFormState>) =>
    setState((current) => ({ ...current, ...next }));

  const errors = improveConfigFormErrors(state);
  const isInvalid = hasImproveConfigFormErrors(errors);
  const hasNoProfiles = !profiles.isLoading && profiles.options.length === 0;

  const builderOptions = profiles.options;
  // A profile cannot review or follow itself in the rotation.
  const otherOptions = builderOptions.filter(
    (option) => option.id !== state.builderProfileId,
  );
  const isChoosingReviewers = state.reviewerMode === "chosen";

  // Every label the rotation could be limited to: the synced repositories as
  // the service names them, plus any label this program already filters on
  // that no longer matches one, so a stale filter is visible and removable.
  const remoteLabels = (remotes.data?.remotes ?? []).map((remote) =>
    remoteDisplayName(remote),
  );
  const labelOptions = [
    ...remoteLabels,
    ...state.repositoryLabels.filter((label) => !remoteLabels.includes(label)),
  ];

  /**
   * Naming reviewers and rotating the builder cannot be combined, so picking
   * the reviewers drops the rotation rather than leaving a selection that the
   * service would refuse. The rotation block says so where it stood.
   */
  const setReviewerMode = (mode: ImproveConfigFormState["reviewerMode"]) =>
    patch(
      mode === "chosen"
        ? { reviewerMode: mode, rotateProfileIds: [] }
        : { reviewerMode: mode, reviewerProfileIds: [] },
    );

  const setRow = (index: number, next: Partial<ImproveRepositoryRow>) =>
    patch({
      repositories: state.repositories.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...next } : row,
      ),
    });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isInvalid) return;
    setFailure(null);
    save.mutate(improveConfigFromForm(state), {
      onSuccess: () =>
        displaySuccessToast(t(I18nKey.AUTOMATIONS$IMPROVE$CONFIG_SAVED)),
      // The service's own detail is the message: it names the constraint that
      // was broken in words the user can act on.
      onError: (error) =>
        setFailure(getApiErrorMessage(error, t(I18nKey.ERROR$GENERIC))),
    });
  };

  return (
    <SectionCard
      icon={<Cog className="size-4" aria-hidden />}
      title={t(I18nKey.AUTOMATIONS$IMPROVE$CONFIG_TITLE)}
    >
      <form
        data-testid="improve-config-form"
        onSubmit={handleSubmit}
        className="flex flex-col gap-6"
      >
        <p className="text-sm text-muted">
          {t(I18nKey.AUTOMATIONS$IMPROVE$CONFIG_DESCRIPTION)}
        </p>

        {hasNoProfiles ? (
          <p
            data-testid="improve-config-no-profiles"
            className="text-sm text-muted"
          >
            {t(I18nKey.AUTOMATIONS$IMPROVE$CONFIG_PROFILES_EMPTY)}
          </p>
        ) : null}
        {profiles.isError ? (
          <p
            role="alert"
            data-testid="improve-config-profiles-error"
            className="text-sm text-feedback-error"
          >
            {t(I18nKey.AUTOMATIONS$IMPROVE$CONFIG_PROFILES_ERROR)}
          </p>
        ) : null}

        <label className="flex flex-col gap-2">
          <span className="text-sm text-content">
            {t(I18nKey.AUTOMATIONS$IMPROVE$CONFIG_BUILDER_LABEL)}
          </span>
          <span className="text-xs text-muted">
            {t(I18nKey.AUTOMATIONS$IMPROVE$CONFIG_BUILDER_HELP)}
          </span>
          <select
            data-testid="improve-config-builder"
            className={cn(formControlSettingsFieldClassName, "w-full")}
            value={state.builderProfileId}
            disabled={profiles.isLoading || profiles.isError}
            onChange={(event) =>
              patch({
                builderProfileId: event.target.value,
                // The new builder can no longer be one of its own reviewers
                // or follow itself in the rotation.
                reviewerProfileIds: state.reviewerProfileIds.filter(
                  (id) => id !== event.target.value,
                ),
                rotateProfileIds: state.rotateProfileIds.filter(
                  (id) => id !== event.target.value,
                ),
              })
            }
          >
            {/* The stored builder may be a profile this backend no longer
                lists; keep it selectable rather than silently reassigning. */}
            {builderOptions.every(
              (option) => option.id !== state.builderProfileId,
            ) ? (
              <option value={state.builderProfileId}>
                {t(I18nKey.AUTOMATIONS$UNAVAILABLE_AGENT_PROFILE, {
                  id: state.builderProfileId,
                })}
              </option>
            ) : null}
            {builderOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {profileLabel(option)}
              </option>
            ))}
          </select>
          {errors.builder ? (
            <span role="alert" className="text-xs text-feedback-error">
              {t(errors.builder)}
            </span>
          ) : null}
        </label>

        <FieldGroup
          testId="improve-config-rotation"
          legend={t(I18nKey.AUTOMATIONS$IMPROVE$CONFIG_ROTATE_LABEL)}
          help={t(I18nKey.AUTOMATIONS$IMPROVE$CONFIG_ROTATE_HELP)}
        >
          {isChoosingReviewers ? (
            <p
              data-testid="improve-config-rotation-unavailable"
              className="text-xs text-muted"
            >
              {t(I18nKey.AUTOMATIONS$IMPROVE$CONFIG_ROTATE_UNAVAILABLE)}
            </p>
          ) : (
            <ProfileChecklist
              testId="improve-config-rotation-option"
              options={otherOptions}
              selected={state.rotateProfileIds}
              max={MAX_IMPROVE_BUILDERS}
              onChange={(rotateProfileIds) => patch({ rotateProfileIds })}
            />
          )}
        </FieldGroup>

        <FieldGroup
          testId="improve-config-reviewers"
          legend={t(I18nKey.AUTOMATIONS$IMPROVE$CONFIG_REVIEWERS_LABEL)}
        >
          <label className="flex items-start gap-2 text-sm text-content">
            <input
              type="radio"
              name="improve-config-reviewer-mode"
              data-testid="improve-config-reviewers-automatic"
              checked={!isChoosingReviewers}
              onChange={() => setReviewerMode("automatic")}
            />
            <span>
              {t(I18nKey.AUTOMATIONS$IMPROVE$CONFIG_REVIEWERS_AUTOMATIC)}
              <span className="mt-1 block text-xs text-muted">
                {t(I18nKey.AUTOMATIONS$IMPROVE$CONFIG_REVIEWERS_AUTOMATIC_HELP)}
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-content">
            <input
              type="radio"
              name="improve-config-reviewer-mode"
              data-testid="improve-config-reviewers-chosen"
              checked={isChoosingReviewers}
              onChange={() => setReviewerMode("chosen")}
            />
            <span>
              {t(I18nKey.AUTOMATIONS$IMPROVE$CONFIG_REVIEWERS_CHOSEN)}
              <span className="mt-1 block text-xs text-muted">
                {t(I18nKey.AUTOMATIONS$IMPROVE$CONFIG_REVIEWERS_CHOSEN_HELP)}
              </span>
            </span>
          </label>
          {isChoosingReviewers ? (
            <ProfileChecklist
              testId="improve-config-reviewer-option"
              options={otherOptions}
              selected={state.reviewerProfileIds}
              max={MAX_IMPROVE_REVIEWERS}
              onChange={(reviewerProfileIds) => patch({ reviewerProfileIds })}
            />
          ) : null}
          {errors.reviewers ? (
            <p
              role="alert"
              data-testid="improve-config-reviewers-error"
              className="text-xs text-feedback-error"
            >
              {t(errors.reviewers)}
            </p>
          ) : null}
        </FieldGroup>

        <FieldGroup
          testId="improve-config-source"
          legend={t(I18nKey.AUTOMATIONS$IMPROVE$CONFIG_SOURCE_LABEL)}
        >
          <label className="flex items-start gap-2 text-sm text-content">
            <input
              type="radio"
              name="improve-config-source"
              data-testid="improve-config-source-git-sync"
              checked={state.repositorySource === "git_sync"}
              onChange={() => patch({ repositorySource: "git_sync" })}
            />
            <span>
              {t(I18nKey.AUTOMATIONS$IMPROVE$CONFIG_SOURCE_GIT_SYNC)}
              <span className="mt-1 block text-xs text-muted">
                {t(I18nKey.AUTOMATIONS$IMPROVE$CONFIG_SOURCE_GIT_SYNC_HELP)}
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-content">
            <input
              type="radio"
              name="improve-config-source"
              data-testid="improve-config-source-explicit"
              checked={state.repositorySource === "explicit"}
              onChange={() => patch({ repositorySource: "explicit" })}
            />
            <span>
              {t(I18nKey.AUTOMATIONS$IMPROVE$CONFIG_SOURCE_EXPLICIT)}
              <span className="mt-1 block text-xs text-muted">
                {t(I18nKey.AUTOMATIONS$IMPROVE$CONFIG_SOURCE_EXPLICIT_HELP)}
              </span>
            </span>
          </label>

          {state.repositorySource === "git_sync" ? (
            <div
              data-testid="improve-config-labels"
              className="flex flex-col gap-1.5"
            >
              <p className="text-xs text-muted">
                {t(I18nKey.AUTOMATIONS$IMPROVE$CONFIG_LABELS_HELP)}
              </p>
              {labelOptions.length === 0 ? (
                <p className="text-xs text-muted">
                  {t(I18nKey.AUTOMATIONS$IMPROVE$CONFIG_LABELS_EMPTY)}
                </p>
              ) : (
                labelOptions.map((label) => (
                  <label
                    key={label}
                    className="flex items-center gap-2 text-sm text-content"
                  >
                    <input
                      type="checkbox"
                      data-testid="improve-config-label-option"
                      data-label={label}
                      checked={state.repositoryLabels.includes(label)}
                      onChange={(event) =>
                        patch({
                          repositoryLabels: event.target.checked
                            ? [...state.repositoryLabels, label]
                            : state.repositoryLabels.filter(
                                (entry) => entry !== label,
                              ),
                        })
                      }
                    />
                    {label}
                  </label>
                ))
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {state.repositories.map((row, index) => {
                const rowErrors = errors.repositoryRows.get(index);
                return (
                  <div
                    // Rows are positional: the rotation order is the list
                    // order, and a row has no id of its own.
                    key={index}
                    data-testid="improve-config-repository-row"
                    className="flex flex-col gap-2 rounded-xl border border-border p-3"
                  >
                    <SettingsInput
                      testId="improve-config-repository-label"
                      type="text"
                      label={t(I18nKey.AUTOMATIONS$GIT_SYNC$FIELD_LABEL)}
                      value={row.label}
                      error={rowErrors?.label ? t(rowErrors.label) : undefined}
                      onChange={(label) => setRow(index, { label })}
                    />
                    <SettingsInput
                      testId="improve-config-repository-url"
                      type="text"
                      label={t(I18nKey.AUTOMATIONS$GIT_SYNC$FIELD_REPO_URL)}
                      value={row.url}
                      error={rowErrors?.url ? t(rowErrors.url) : undefined}
                      onChange={(url) => setRow(index, { url })}
                    />
                    <SettingsInput
                      testId="improve-config-repository-ref"
                      type="text"
                      label={t(I18nKey.AUTOMATIONS$GIT_SYNC$FIELD_BRANCH)}
                      showOptionalTag
                      value={row.ref}
                      onChange={(ref) => setRow(index, { ref })}
                    />
                    <BrandButton
                      testId="improve-config-repository-remove"
                      type="button"
                      variant="tertiary"
                      onClick={() =>
                        patch({
                          repositories: state.repositories.filter(
                            (_entry, entryIndex) => entryIndex !== index,
                          ),
                        })
                      }
                    >
                      {t(I18nKey.COMMON$REMOVE)}
                    </BrandButton>
                  </div>
                );
              })}
              {errors.repositories ? (
                <p
                  role="alert"
                  data-testid="improve-config-repositories-error"
                  className="text-xs text-feedback-error"
                >
                  {t(errors.repositories)}
                </p>
              ) : null}
              <BrandButton
                testId="improve-config-repository-add"
                type="button"
                variant="secondary"
                isDisabled={
                  state.repositories.length >= MAX_IMPROVE_REPOSITORIES
                }
                onClick={() =>
                  patch({ repositories: [...state.repositories, EMPTY_ROW] })
                }
              >
                {t(I18nKey.AUTOMATIONS$IMPROVE$CONFIG_REPOSITORY_ADD)}
              </BrandButton>
            </div>
          )}
        </FieldGroup>

        <SettingsInput
          testId="improve-config-branch-prefix"
          type="text"
          label={t(I18nKey.AUTOMATIONS$IMPROVE$CONFIG_BRANCH_PREFIX_LABEL)}
          hint={t(I18nKey.AUTOMATIONS$IMPROVE$CONFIG_BRANCH_PREFIX_HELP)}
          value={state.branchPrefix}
          error={errors.branchPrefix ? t(errors.branchPrefix) : undefined}
          onChange={(branchPrefix) => patch({ branchPrefix })}
        />

        <SettingsInput
          testId="improve-config-max-files"
          type="number"
          min={MIN_IMPROVE_CHANGED_FILES}
          max={MAX_IMPROVE_CHANGED_FILES}
          label={t(I18nKey.AUTOMATIONS$IMPROVE$CONFIG_MAX_FILES_LABEL)}
          hint={t(I18nKey.AUTOMATIONS$IMPROVE$CONFIG_MAX_FILES_HELP)}
          value={state.maxChangedFiles}
          error={
            errors.maxChangedFiles
              ? t(errors.maxChangedFiles, {
                  min: String(MIN_IMPROVE_CHANGED_FILES),
                  max: String(MAX_IMPROVE_CHANGED_FILES),
                })
              : undefined
          }
          onChange={(maxChangedFiles) => patch({ maxChangedFiles })}
        />

        <div className="flex flex-col gap-2">
          <SettingsSwitch
            testId="improve-config-open-pr"
            isToggled={state.openPr}
            onToggle={(openPr) => patch({ openPr })}
          >
            {t(I18nKey.AUTOMATIONS$IMPROVE$CONFIG_OPEN_PR_LABEL)}
          </SettingsSwitch>
          <p className="text-xs text-muted">
            {t(I18nKey.AUTOMATIONS$IMPROVE$CONFIG_OPEN_PR_HELP)}
          </p>
        </div>

        <label className="flex flex-col gap-2">
          <span className="text-sm text-content">
            {t(I18nKey.AUTOMATIONS$IMPROVE$CONFIG_FOCUS_LABEL)}
          </span>
          <span className="text-xs text-muted">
            {t(I18nKey.AUTOMATIONS$IMPROVE$CONFIG_FOCUS_HELP)}
          </span>
          <textarea
            data-testid="improve-config-focus"
            rows={3}
            className={cn(formControlMultilineFieldClassName, "w-full p-3")}
            placeholder={t(
              I18nKey.AUTOMATIONS$IMPROVE$CONFIG_FOCUS_PLACEHOLDER,
            )}
            value={state.focus}
            onChange={(event) => patch({ focus: event.target.value })}
          />
        </label>

        {failure ? (
          <p
            role="alert"
            data-testid="improve-config-failure"
            className="whitespace-pre-wrap break-words text-sm text-feedback-error"
          >
            {failure}
          </p>
        ) : null}

        <div className="flex justify-start">
          <BrandButton
            testId="improve-config-save"
            type="submit"
            variant="primary"
            isDisabled={isInvalid || save.isPending || hasNoProfiles}
          >
            {save.isPending
              ? t(I18nKey.SETTINGS$SAVING)
              : t(I18nKey.SETTINGS$SAVE_CHANGES)}
          </BrandButton>
        </div>
      </form>
    </SectionCard>
  );
}
