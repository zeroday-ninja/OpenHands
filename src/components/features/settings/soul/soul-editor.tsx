import { useState } from "react";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import {
  MAX_SOUL_LENGTH,
  type SoulResponse,
} from "#/api/soul-service/soul.types";
import { BrandButton } from "#/components/features/settings/brand-button";
import { ConfirmationModal } from "#/components/shared/modals/confirmation-modal";
import { useSaveSoul } from "#/hooks/mutation/use-save-soul";
import {
  displayErrorToast,
  displaySuccessToast,
} from "#/utils/custom-toast-handlers";
import { getApiErrorMessage } from "#/utils/api-error-message";
import { formControlMultilineFieldClassName } from "#/utils/form-control-classes";
import { cn } from "#/utils/utils";

/**
 * Read and write the user's SOUL.md.
 *
 * The saved text belongs to the query cache, which is also what the server
 * normalizes on write, so the editor keeps only a draft: `null` means
 * "showing the saved text", and a successful save drops back to null rather
 * than keeping a second copy of the server's answer.
 */
export function SoulEditor({ soul }: { soul: SoulResponse }) {
  const { t } = useTranslation("openhands");
  const [draft, setDraft] = useState<string | null>(null);
  const [isConfirmingRevert, setIsConfirmingRevert] = useState(false);
  const save = useSaveSoul();

  const content = draft ?? soul.content;
  const isDirty = draft !== null && draft !== soul.content;
  const isOverLimit = content.length > MAX_SOUL_LENGTH;

  const submit = (next: string, successMessage: string) => {
    save.mutate(next, {
      onSuccess: () => {
        setDraft(null);
        setIsConfirmingRevert(false);
        displaySuccessToast(successMessage);
      },
      onError: (error) => {
        displayErrorToast(
          getApiErrorMessage(error, t(I18nKey.SETTINGS$SOUL_SAVE_ERROR)),
        );
      },
    });
  };

  return (
    <div data-testid="soul-editor" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span
          data-testid="soul-origin"
          data-exists={soul.exists}
          className={cn(
            "inline-flex items-center rounded-full px-2.5 py-1 font-medium",
            soul.exists
              ? "bg-primary/10 text-primary"
              : "bg-surface-raised text-muted",
          )}
        >
          {t(
            soul.exists
              ? I18nKey.SETTINGS$SOUL_OWN_FILE
              : I18nKey.SETTINGS$SOUL_BUILT_IN_DEFAULT,
          )}
        </span>
        <span className="flex min-w-0 items-baseline gap-1 text-muted">
          {t(I18nKey.SETTINGS$SOUL_PATH_LABEL)}
          <code data-testid="soul-path" className="truncate font-mono">
            {soul.path}
          </code>
        </span>
      </div>

      <label className="flex flex-col gap-2">
        <span className="text-sm text-contrast">
          {t(I18nKey.SETTINGS$SOUL_EDITOR_LABEL)}
        </span>
        <textarea
          data-testid="soul-content-input"
          rows={18}
          spellCheck={false}
          value={content}
          aria-describedby="soul-character-count"
          aria-invalid={isOverLimit}
          disabled={save.isPending}
          onChange={(event) => setDraft(event.target.value)}
          className={cn(
            formControlMultilineFieldClassName,
            "font-mono text-xs",
          )}
        />
      </label>

      <p
        id="soul-character-count"
        data-testid="soul-character-count"
        className={cn(
          "text-xs",
          isOverLimit ? "text-feedback-error" : "text-muted",
        )}
      >
        {t(I18nKey.SETTINGS$SOUL_CHARACTER_COUNT, {
          chars: content.length,
          max: MAX_SOUL_LENGTH,
        })}
      </p>

      {isOverLimit ? (
        <p data-testid="soul-too-long" className="text-xs text-feedback-error">
          {t(I18nKey.SETTINGS$SOUL_TOO_LONG, {
            excess: content.length - MAX_SOUL_LENGTH,
            max: MAX_SOUL_LENGTH,
          })}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <BrandButton
          testId="soul-save-button"
          type="button"
          variant="primary"
          isDisabled={!isDirty || isOverLimit || save.isPending}
          onClick={() => submit(content, t(I18nKey.SETTINGS$SOUL_SAVED))}
        >
          {t(I18nKey.SETTINGS$SAVE)}
        </BrandButton>
        <BrandButton
          testId="soul-revert-button"
          type="button"
          variant="secondary"
          isDisabled={!soul.exists || save.isPending}
          onClick={() => setIsConfirmingRevert(true)}
        >
          {t(I18nKey.SETTINGS$SOUL_REVERT)}
        </BrandButton>
      </div>

      {isConfirmingRevert ? (
        <ConfirmationModal
          text={t(I18nKey.SETTINGS$SOUL_REVERT_CONFIRM)}
          confirmText={t(I18nKey.SETTINGS$SOUL_REVERT)}
          isConfirming={save.isPending}
          // An empty body is how the server is told to delete the file; it
          // answers with the built-in default, which the cache then holds.
          onConfirm={() => submit("", t(I18nKey.SETTINGS$SOUL_REVERTED))}
          onCancel={() => setIsConfirmingRevert(false)}
        />
      ) : null}
    </div>
  );
}
