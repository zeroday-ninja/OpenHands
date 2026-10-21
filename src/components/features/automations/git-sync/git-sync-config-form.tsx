import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import { SettingsInput } from "#/components/features/settings/settings-input";
import { SettingsSwitch } from "#/components/features/settings/settings-switch";
import { BrandButton } from "#/components/features/settings/brand-button";
import { SectionCard } from "#/components/features/automations/detail/section-card";
import CogIcon from "#/icons/cog.svg?react";
import {
  displayErrorToast,
  displaySuccessToast,
} from "#/utils/custom-toast-handlers";
import { getApiErrorMessage } from "#/utils/api-error-message";
import {
  useCheckGitSyncConfig,
  useCheckGitSyncRemote,
  useCreateGitSyncRemote,
  useUpdateGitSyncConfig,
  useUpdateGitSyncRemote,
} from "#/hooks/query/use-git-sync";
import type {
  GitSyncCheckResponse,
  GitSyncConfigUpdateRequest,
  GitSyncRemoteStatus,
  GitSyncRemoteUpdateRequest,
  GitSyncStatus,
} from "#/types/git-sync";

/**
 * Identifies the save-and-sync button in the submit event. Read from the
 * event's `submitter` rather than tracked on click: native field validation
 * (the author email, the interval) can swallow a submit after the click has
 * already happened, and a flag set there would still be armed when Save is
 * pressed next -- syncing off a button that never asked for it.
 */
const SAVE_AND_SYNC = "git-sync-save-and-sync";

/** What a repository about to be added starts from: nothing configured. */
export const NEW_REMOTE_STATUS: GitSyncStatus = {
  enabled: true,
  repo_url: "",
  branch: "main",
  path: "automations",
  encryption_enabled: false,
  interval_seconds: 0,
  last_synced_commit: null,
  last_synced_at: null,
  last_error: null,
  last_error_at: null,
  dirty_count: 0,
};

/**
 * Which repository the form edits. Absent, it edits the organization's single
 * repository through the legacy config endpoint. With an `id` it edits that
 * remote; with `id: null` it adds a new one.
 */
export interface GitSyncFormRemote {
  id: string | null;
  label: string;
}

interface GitSyncConfigFormProps {
  status: GitSyncStatus;
  canManage: boolean;
  /**
   * Runs a sync cycle. The same handler the overview's Sync now button uses,
   * so a save-and-sync is followed by the one activity row rather than
   * starting a cycle nothing on the page is watching.
   */
  onSyncNow: () => void;
  remote?: GitSyncFormRemote;
  /** A new remote was added; `thenSync` when "Add and sync now" was pressed. */
  onCreated?: (remote: GitSyncRemoteStatus, thenSync: boolean) => void;
  /** Rendered as a Cancel button when given (the add-repository form). */
  onCancel?: () => void;
}

export function GitSyncConfigForm({
  status,
  canManage,
  onSyncNow,
  remote,
  onCreated,
  onCancel,
}: GitSyncConfigFormProps) {
  const { t } = useTranslation("openhands");
  const isCreate = remote?.id === null;

  const legacyUpdate = useUpdateGitSyncConfig();
  const legacyCheck = useCheckGitSyncConfig();
  const remoteUpdate = useUpdateGitSyncRemote();
  const remoteCreate = useCreateGitSyncRemote();
  const remoteCheck = useCheckGitSyncRemote();

  const isPending =
    legacyUpdate.isPending || remoteUpdate.isPending || remoteCreate.isPending;
  const isChecking = legacyCheck.isPending || remoteCheck.isPending;

  // The settings that failed their reachability check, so the same submit
  // pressed a second time saves them anyway. Keyed by the values that were
  // checked rather than a plain flag: editing any of them changes the key,
  // which re-arms the check without the field handlers having to clear it.
  const [failedCheck, setFailedCheck] = useState<{
    key: string;
    detail: string;
  } | null>(null);

  const [labelHasChanged, setLabelHasChanged] = useState(false);
  const [intervalHasChanged, setIntervalHasChanged] = useState(false);
  const [repoUrlHasChanged, setRepoUrlHasChanged] = useState(false);
  const [branchHasChanged, setBranchHasChanged] = useState(false);
  const [pathHasChanged, setPathHasChanged] = useState(false);
  const [authorNameHasChanged, setAuthorNameHasChanged] = useState(false);
  const [authorEmailHasChanged, setAuthorEmailHasChanged] = useState(false);

  // `null` means untouched, so the switch keeps following the server state
  // (including a status refetch) until the operator actually flips it.
  const [enabledOverride, setEnabledOverride] = useState<boolean | null>(null);
  const enabled = enabledOverride ?? status.enabled;
  const enabledHasChanged =
    enabledOverride !== null && enabled !== status.enabled;

  const [tokenText, setTokenText] = useState("");
  const [clearToken, setClearToken] = useState(false);
  const [encryptionKeyText, setEncryptionKeyText] = useState("");
  const [clearEncryptionKey, setClearEncryptionKey] = useState(false);

  const tokenHasChanged = tokenText.trim().length > 0 || clearToken;
  const encryptionKeyHasChanged =
    encryptionKeyText.trim().length > 0 || clearEncryptionKey;

  const formIsClean =
    !enabledHasChanged &&
    !labelHasChanged &&
    !intervalHasChanged &&
    !repoUrlHasChanged &&
    !branchHasChanged &&
    !pathHasChanged &&
    !authorNameHasChanged &&
    !authorEmailHasChanged &&
    !tokenHasChanged &&
    !encryptionKeyHasChanged;

  const resetChangeFlags = () => {
    setEnabledOverride(null);
    setLabelHasChanged(false);
    setIntervalHasChanged(false);
    setRepoUrlHasChanged(false);
    setBranchHasChanged(false);
    setPathHasChanged(false);
    setAuthorNameHasChanged(false);
    setAuthorEmailHasChanged(false);
    setTokenText("");
    setClearToken(false);
    setEncryptionKeyText("");
    setClearEncryptionKey(false);
    setFailedCheck(null);
  };

  // The secret inputs are remounted -- and therefore emptied -- whenever the
  // matching clear switch flips, so drop the typed value with them. Keeping it
  // in state would leave the field marked dirty against an empty input and
  // submit `token: ""`, an override that fails every later push with
  // `fatal: Authentication failed`.
  const toggleClearToken = (isToggled: boolean) => {
    setClearToken(isToggled);
    setTokenText("");
  };

  const toggleClearEncryptionKey = (isToggled: boolean) => {
    setClearEncryptionKey(isToggled);
    setEncryptionKeyText("");
  };

  // A cleared field posts `null` -- clear the override and fall back to the
  // environment default -- rather than `""`, which the backend stored as a
  // literal empty override. An empty branch or path then made the next git
  // command fatal (`git checkout -B ""`, `git add -A -- ""`), wedging every
  // subsequent sync cycle with that error in the status banner.
  const clearedFieldAsNull = (formData: FormData, name: string) =>
    formData.get(name)?.toString().trim() || null;

  const onSaveError = (error: unknown) => {
    // The backend's detail is the message: a 409 means another repository
    // configuration already syncs this repository, branch and path, and it
    // says so in words the operator can act on.
    displayErrorToast(getApiErrorMessage(error, t(I18nKey.ERROR$GENERIC)));
  };

  const save = (body: GitSyncRemoteUpdateRequest, thenSync: boolean) => {
    if (isCreate) {
      // The backend requires a URL to add a repository, so a form that
      // never got one has nothing to send.
      const repoUrl = body.repo_url;
      if (!repoUrl) return;
      remoteCreate.mutate(
        { ...body, repo_url: repoUrl },
        {
          onSuccess: (created) => {
            displaySuccessToast(
              t(I18nKey.AUTOMATIONS$GIT_SYNC$REPOSITORY_ADDED),
            );
            resetChangeFlags();
            onCreated?.(created, thenSync);
          },
          onError: onSaveError,
        },
      );
      return;
    }

    const onSuccess = () => {
      displaySuccessToast(t(I18nKey.AUTOMATIONS$GIT_SYNC$CONFIG_SAVED));
      // Only on success: clearing the flags after a failure would disable
      // Save and silently un-toggle the clear switches, leaving no way to
      // retry the change that was just rejected.
      resetChangeFlags();
      // A cycle runs off the stored configuration, so it can only be
      // triggered once the save has landed -- and a rejected save leaves
      // nothing new to sync.
      if (thenSync) onSyncNow();
    };
    if (remote?.id) {
      remoteUpdate.mutate(
        { remoteId: remote.id, body },
        { onSuccess, onError: onSaveError },
      );
    } else {
      legacyUpdate.mutate(body, { onSuccess, onError: onSaveError });
    }
  };

  // What the reachability check actually depends on. A save that touches only
  // the interval or the author has nothing for the remote to reject, so it
  // shouldn't cost a round trip to the repo.
  const remoteFieldsOf = (body: GitSyncConfigUpdateRequest) =>
    (["repo_url", "branch", "token"] as const)
      .filter((field) => field in body)
      .map((field) => `${field}=${body[field]}`)
      .join("&");

  const check = (body: GitSyncConfigUpdateRequest) =>
    remote === undefined
      ? legacyCheck.mutateAsync(body)
      : remoteCheck.mutateAsync({ remoteId: remote.id, body });

  /** The reason these settings can't reach their repo, or null to go ahead. */
  const reachabilityFailure = async (body: GitSyncConfigUpdateRequest) => {
    try {
      const result: GitSyncCheckResponse = await check(body);
      return result.ok
        ? null
        : (result.detail ?? t(I18nKey.AUTOMATIONS$GIT_SYNC$CHECK_FAILED_TITLE));
    } catch {
      // A check that couldn't run says nothing about the configuration --
      // an automation backend that predates the endpoint answers 404 -- and
      // must never be what stands between an operator and saving.
      return null;
    }
  };

  // A plain submit handler rather than `<form action={...}>`: React resets an
  // uncontrolled form as soon as the action returns, which wiped every edit
  // while the save was still in flight -- so a rejected save left the operator
  // with the old values and nothing to retry.
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const thenSync =
      (event.nativeEvent as SubmitEvent).submitter?.getAttribute("name") ===
      SAVE_AND_SYNC;
    const formData = new FormData(event.currentTarget);
    const body: GitSyncRemoteUpdateRequest = {};

    if (enabledHasChanged) {
      body.enabled = enabled;
    }
    if (labelHasChanged) {
      body.label =
        formData.get("git-sync-label-input")?.toString().trim() ?? "";
    }
    if (intervalHasChanged) {
      // Blank reads as manual-only rather than clearing the override, so an
      // emptied field can never be mistaken for "keep syncing on a timer".
      const raw = formData.get("git-sync-interval-input")?.toString().trim();
      const parsed = Number(raw);
      body.interval_seconds =
        raw && Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
    }
    if (repoUrlHasChanged) {
      body.repo_url = clearedFieldAsNull(formData, "git-sync-repo-url-input");
    }
    if (branchHasChanged) {
      body.branch = clearedFieldAsNull(formData, "git-sync-branch-input");
    }
    if (pathHasChanged) {
      body.path = clearedFieldAsNull(formData, "git-sync-path-input");
    }
    if (authorNameHasChanged) {
      body.author_name = clearedFieldAsNull(
        formData,
        "git-sync-author-name-input",
      );
    }
    if (authorEmailHasChanged) {
      body.author_email = clearedFieldAsNull(
        formData,
        "git-sync-author-email-input",
      );
    }
    // The secrets come from state rather than FormData: the clear switch
    // remounts (and empties) their inputs, so the two disagree for a render
    // and only state knows what the operator actually typed.
    const token = tokenText.trim();
    const encryptionKey = encryptionKeyText.trim();
    if (clearToken) {
      body.token = null;
    } else if (token) {
      body.token = token;
    }
    if (clearEncryptionKey) {
      body.encryption_key = null;
    } else if (encryptionKey) {
      body.encryption_key = encryptionKey;
    }

    // Test the settings before storing them, so a mistyped repo URL or a
    // rejected token is caught here instead of by the next sync cycle. The
    // same values submitted twice save anyway: an operator who disagrees with
    // the check -- or whose remote refuses `ls-remote` but accepts a push --
    // must not be locked out of their own configuration.
    const remoteFields = remoteFieldsOf(body);
    if (remoteFields && failedCheck?.key !== remoteFields) {
      const detail = await reachabilityFailure(body);
      if (detail) {
        setFailedCheck({ key: remoteFields, detail });
        return;
      }
    }
    setFailedCheck(null);

    save(body, thenSync);
  };

  const saveLabel = isCreate
    ? t(I18nKey.BUTTON$ADD)
    : t(I18nKey.SETTINGS$SAVE_CHANGES);
  const saveAndSyncLabel = isCreate
    ? t(I18nKey.AUTOMATIONS$GIT_SYNC$ADD_AND_SYNC)
    : t(I18nKey.AUTOMATIONS$GIT_SYNC$SAVE_AND_SYNC);

  return (
    <SectionCard
      icon={<CogIcon className="size-4" />}
      title={t(
        isCreate
          ? I18nKey.AUTOMATIONS$GIT_SYNC$NEW_REPOSITORY_TITLE
          : I18nKey.AUTOMATIONS$GIT_SYNC$CONFIG_TITLE,
      )}
    >
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-6"
        data-testid={isCreate ? "git-sync-new-remote-form" : undefined}
      >
        {remote !== undefined && (
          <SettingsInput
            testId="git-sync-label-input"
            name="git-sync-label-input"
            type="text"
            label={t(I18nKey.AUTOMATIONS$GIT_SYNC$FIELD_LABEL)}
            showOptionalTag
            defaultValue={remote.label}
            placeholder={t(I18nKey.AUTOMATIONS$GIT_SYNC$LABEL_PLACEHOLDER)}
            isDisabled={!canManage}
            onChange={(value) =>
              setLabelHasChanged(value.trim() !== remote.label.trim())
            }
          />
        )}

        <div className="flex flex-col gap-2">
          <SettingsSwitch
            testId="git-sync-enabled-switch"
            isToggled={enabled}
            isDisabled={!canManage}
            onToggle={setEnabledOverride}
          >
            {t(I18nKey.AUTOMATIONS$GIT_SYNC$FIELD_ENABLED)}
          </SettingsSwitch>
          <p className="text-xs text-muted">
            {t(I18nKey.AUTOMATIONS$GIT_SYNC$ENABLED_HELP)}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <SettingsInput
            testId="git-sync-interval-input"
            name="git-sync-interval-input"
            type="number"
            min={0}
            label={t(I18nKey.AUTOMATIONS$GIT_SYNC$FIELD_INTERVAL)}
            defaultValue={String(status.interval_seconds)}
            isDisabled={!canManage}
            onChange={(value) =>
              setIntervalHasChanged(
                value.trim() !== String(status.interval_seconds),
              )
            }
          />
          <p className="text-xs text-muted">
            {t(I18nKey.AUTOMATIONS$GIT_SYNC$INTERVAL_HELP)}
          </p>
        </div>

        <SettingsInput
          testId="git-sync-repo-url-input"
          name="git-sync-repo-url-input"
          type="text"
          label={t(I18nKey.AUTOMATIONS$GIT_SYNC$FIELD_REPO_URL)}
          defaultValue={status.repo_url}
          placeholder={t(I18nKey.AUTOMATIONS$GIT_SYNC$REPO_URL_PLACEHOLDER)}
          isDisabled={!canManage}
          required={isCreate}
          onChange={(value) =>
            setRepoUrlHasChanged(value.trim() !== status.repo_url)
          }
        />

        <SettingsInput
          testId="git-sync-branch-input"
          name="git-sync-branch-input"
          type="text"
          label={t(I18nKey.AUTOMATIONS$GIT_SYNC$FIELD_BRANCH)}
          defaultValue={status.branch}
          placeholder={t(I18nKey.AUTOMATIONS$GIT_SYNC$BRANCH_PLACEHOLDER)}
          isDisabled={!canManage}
          onChange={(value) =>
            setBranchHasChanged(value.trim() !== status.branch)
          }
        />

        <SettingsInput
          testId="git-sync-path-input"
          name="git-sync-path-input"
          type="text"
          label={t(I18nKey.AUTOMATIONS$GIT_SYNC$FIELD_PATH)}
          defaultValue={status.path}
          placeholder={t(I18nKey.AUTOMATIONS$GIT_SYNC$PATH_PLACEHOLDER)}
          isDisabled={!canManage}
          onChange={(value) => setPathHasChanged(value.trim() !== status.path)}
        />

        <div className="flex flex-col gap-2">
          <SettingsInput
            testId="git-sync-author-name-input"
            name="git-sync-author-name-input"
            type="text"
            label={t(I18nKey.AUTOMATIONS$GIT_SYNC$FIELD_AUTHOR_NAME)}
            showOptionalTag
            defaultValue=""
            isDisabled={!canManage}
            // Dirty on any edit, not just a non-empty one: gating on the value
            // meant emptying the field never posted `author_name: null`, so a
            // wrong override could never be cleared back to the default.
            onChange={() => setAuthorNameHasChanged(true)}
          />

          <SettingsInput
            testId="git-sync-author-email-input"
            name="git-sync-author-email-input"
            type="email"
            label={t(I18nKey.AUTOMATIONS$GIT_SYNC$FIELD_AUTHOR_EMAIL)}
            showOptionalTag
            defaultValue=""
            isDisabled={!canManage}
            onChange={() => setAuthorEmailHasChanged(true)}
          />
          <p className="text-xs text-muted">
            {t(I18nKey.AUTOMATIONS$GIT_SYNC$AUTHOR_HELP)}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <SettingsInput
            key={clearToken ? "token-cleared" : "token-editable"}
            testId="git-sync-token-input"
            name="git-sync-token-input"
            type="password"
            label={t(I18nKey.AUTOMATIONS$GIT_SYNC$FIELD_TOKEN)}
            placeholder={
              isCreate
                ? undefined
                : t(I18nKey.AUTOMATIONS$GIT_SYNC$TOKEN_PLACEHOLDER)
            }
            isDisabled={!canManage || clearToken}
            onChange={setTokenText}
          />
          <p className="text-xs text-muted">
            {t(I18nKey.AUTOMATIONS$GIT_SYNC$TOKEN_HELP)}
          </p>
          {/* Nothing stored yet to clear on a repository being added. */}
          {!isCreate && (
            <SettingsSwitch
              testId="git-sync-clear-token-switch"
              isToggled={clearToken}
              isDisabled={!canManage}
              onToggle={toggleClearToken}
            >
              {t(I18nKey.AUTOMATIONS$GIT_SYNC$CLEAR_TOKEN)}
            </SettingsSwitch>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <SettingsInput
            key={clearEncryptionKey ? "key-cleared" : "key-editable"}
            testId="git-sync-encryption-key-input"
            name="git-sync-encryption-key-input"
            type="password"
            label={t(I18nKey.AUTOMATIONS$GIT_SYNC$FIELD_ENCRYPTION_KEY)}
            placeholder={t(
              status.encryption_enabled
                ? I18nKey.AUTOMATIONS$GIT_SYNC$KEY_SET_PLACEHOLDER
                : I18nKey.AUTOMATIONS$GIT_SYNC$KEY_UNSET_PLACEHOLDER,
            )}
            isDisabled={!canManage || clearEncryptionKey}
            onChange={setEncryptionKeyText}
          />
          <p className="text-xs text-muted">
            {t(I18nKey.AUTOMATIONS$GIT_SYNC$ENCRYPTION_KEY_HELP)}
          </p>
          {!isCreate && (
            <SettingsSwitch
              testId="git-sync-clear-encryption-key-switch"
              isToggled={clearEncryptionKey}
              isDisabled={!canManage}
              onToggle={toggleClearEncryptionKey}
            >
              {t(I18nKey.AUTOMATIONS$GIT_SYNC$CLEAR_ENCRYPTION_KEY)}
            </SettingsSwitch>
          )}
        </div>

        {failedCheck && (
          <div
            role="alert"
            data-testid="git-sync-check-failure"
            className="rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-feedback-error whitespace-pre-wrap break-words"
          >
            <p className="font-medium">
              {t(I18nKey.AUTOMATIONS$GIT_SYNC$CHECK_FAILED_TITLE)}
            </p>
            <p className="mt-1">{failedCheck.detail}</p>
            <p className="mt-1 text-xs">
              {t(I18nKey.AUTOMATIONS$GIT_SYNC$CHECK_FAILED_HINT)}
            </p>
          </div>
        )}

        <div className="flex flex-wrap justify-start gap-3">
          <BrandButton
            testId="git-sync-save-button"
            variant="primary"
            type="submit"
            isDisabled={!canManage || isPending || isChecking || formIsClean}
          >
            {!isPending && !isChecking && saveLabel}
            {isChecking && t(I18nKey.AUTOMATIONS$GIT_SYNC$CHECKING)}
            {isPending && t(I18nKey.SETTINGS$SAVING)}
          </BrandButton>
          <BrandButton
            testId="git-sync-save-and-sync-button"
            name={SAVE_AND_SYNC}
            variant="secondary"
            type="submit"
            // Sync left off is a 503 from the trigger, so there is nothing to
            // offer -- but a save that turns it on can sync straight after.
            isDisabled={
              !canManage || isPending || isChecking || formIsClean || !enabled
            }
          >
            {saveAndSyncLabel}
          </BrandButton>
          {onCancel && (
            <BrandButton
              testId="git-sync-cancel-button"
              variant="tertiary"
              type="button"
              onClick={onCancel}
              isDisabled={isPending}
            >
              {t(I18nKey.BUTTON$CANCEL)}
            </BrandButton>
          )}
        </div>
      </form>
    </SectionCard>
  );
}
