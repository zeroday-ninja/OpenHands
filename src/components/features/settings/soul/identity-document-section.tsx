import { useState } from "react";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import {
  MAX_IDENTITY_DOCUMENT_LENGTH,
  type IdentityDocumentResponse,
} from "#/api/soul-service/soul.types";
import { BrandButton } from "#/components/features/settings/brand-button";
import { ConfirmationModal } from "#/components/shared/modals/confirmation-modal";
import { useSaveIdentityDocument } from "#/hooks/mutation/use-save-identity-document";
import {
  displayErrorToast,
  displaySuccessToast,
} from "#/utils/custom-toast-handlers";
import { getApiErrorMessage } from "#/utils/api-error-message";
import { formControlMultilineFieldClassName } from "#/utils/form-control-classes";
import { cn } from "#/utils/utils";

/**
 * One document of the identity set: what belongs in it, whether anything has
 * been written, and the text itself.
 *
 * Each section saves on its own. A document is a separate file with its own
 * meaning and its own lifetime — voice changes slowly, memory is appended —
 * so one "save everything" button would write five documents nobody edited,
 * and a failure would leave the user unable to say which one did not land.
 *
 * The saved text belongs to the query cache, so this keeps only a draft:
 * `null` means "showing what the server has", and a successful save drops
 * back to null rather than holding a second copy of the server's answer.
 */
export function IdentityDocumentSection({
  // Renamed off the DOM global, the way the project-map components do.
  document: doc,
}: {
  document: IdentityDocumentResponse;
}) {
  const { t } = useTranslation("openhands");
  const [draft, setDraft] = useState<string | null>(null);
  const [isConfirmingClear, setIsConfirmingClear] = useState(false);
  const save = useSaveIdentityDocument();

  const content = draft ?? doc.content;
  const isDirty = draft !== null && draft !== doc.content;
  const isOverLimit = content.length > MAX_IDENTITY_DOCUMENT_LENGTH;
  // Blank content deletes the document rather than writing an empty file, so
  // emptying a written document is a clear, and is named one: a "Save" that
  // removes the file reads as an accident even when it is what was meant.
  const isClearing = doc.exists && content.trim() === "";
  const headingId = `identity-document-${doc.name}-heading`;
  const purposeId = `identity-document-${doc.name}-purpose`;
  const countId = `identity-document-${doc.name}-count`;

  const submit = (next: string, successMessage: string) => {
    save.mutate(
      { name: doc.name, content: next },
      {
        onSuccess: () => {
          setDraft(null);
          setIsConfirmingClear(false);
          displaySuccessToast(successMessage);
        },
        onError: (error) => {
          displayErrorToast(
            getApiErrorMessage(error, t(I18nKey.SETTINGS$SOUL_SAVE_ERROR)),
          );
        },
      },
    );
  };

  return (
    <section
      data-testid="identity-document-section"
      data-name={doc.name}
      className="flex flex-col gap-3 rounded-xl border border-border p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3
          id={headingId}
          data-testid="identity-document-path"
          className="font-mono text-sm text-contrast"
        >
          {doc.relative_path}
        </h3>
        <span
          data-testid="identity-document-status"
          data-exists={doc.exists}
          className={cn(
            "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium",
            doc.exists
              ? "bg-primary/10 text-primary"
              : "bg-surface-raised text-muted",
          )}
        >
          {t(
            doc.exists
              ? I18nKey.SETTINGS$IDENTITY_DOCUMENT_WRITTEN
              : I18nKey.SETTINGS$IDENTITY_DOCUMENT_NOT_WRITTEN,
          )}
        </span>
      </div>

      {/* The server owns this sentence (`context/identity.py`), so it is
          rendered as data rather than translated here: a document's purpose
          has to match the build that will read it. */}
      <p
        id={purposeId}
        data-testid="identity-document-purpose"
        className="text-sm text-tertiary-light"
      >
        {doc.purpose}
      </p>

      <textarea
        data-testid="identity-document-input"
        rows={8}
        spellCheck={false}
        value={content}
        aria-labelledby={headingId}
        aria-describedby={`${purposeId} ${countId}`}
        aria-invalid={isOverLimit}
        disabled={save.isPending}
        onChange={(event) => setDraft(event.target.value)}
        className={cn(formControlMultilineFieldClassName, "font-mono text-xs")}
      />

      <p
        id={countId}
        data-testid="identity-document-character-count"
        className={cn(
          "text-xs",
          isOverLimit ? "text-feedback-error" : "text-muted",
        )}
      >
        {t(I18nKey.SETTINGS$SOUL_CHARACTER_COUNT, {
          chars: content.length,
          max: MAX_IDENTITY_DOCUMENT_LENGTH,
        })}
      </p>

      {isOverLimit ? (
        <p
          data-testid="identity-document-too-long"
          className="text-xs text-feedback-error"
        >
          {t(I18nKey.SETTINGS$SOUL_TOO_LONG, {
            excess: content.length - MAX_IDENTITY_DOCUMENT_LENGTH,
            max: MAX_IDENTITY_DOCUMENT_LENGTH,
          })}
        </p>
      ) : null}

      {/* Said before the button is pressed, not only in the confirmation:
          the user who emptied the box should know what the next click does. */}
      {isClearing ? (
        <p
          data-testid="identity-document-clear-note"
          className="text-xs text-muted"
        >
          {t(I18nKey.SETTINGS$IDENTITY_DOCUMENT_CLEAR_NOTE)}
        </p>
      ) : null}

      {isClearing ? (
        <BrandButton
          testId="identity-document-clear-button"
          type="button"
          variant="danger"
          className="self-start"
          isDisabled={save.isPending}
          onClick={() => setIsConfirmingClear(true)}
        >
          {t(I18nKey.SETTINGS$IDENTITY_DOCUMENT_CLEAR)}
        </BrandButton>
      ) : (
        <BrandButton
          testId="identity-document-save-button"
          type="button"
          variant="primary"
          className="self-start"
          isDisabled={!isDirty || isOverLimit || save.isPending}
          onClick={() => submit(content, t(I18nKey.SETTINGS$SOUL_SAVED))}
        >
          {t(I18nKey.SETTINGS$SAVE)}
        </BrandButton>
      )}

      {isConfirmingClear ? (
        <ConfirmationModal
          text={t(I18nKey.SETTINGS$IDENTITY_DOCUMENT_CLEAR_CONFIRM, {
            path: doc.relative_path,
          })}
          confirmText={t(I18nKey.SETTINGS$IDENTITY_DOCUMENT_CLEAR)}
          isConfirming={save.isPending}
          // An empty body is how the server is told to delete the file; it
          // answers with the document as unwritten, which the cache holds.
          onConfirm={() =>
            submit("", t(I18nKey.SETTINGS$IDENTITY_DOCUMENT_CLEARED))
          }
          onCancel={() => setIsConfirmingClear(false)}
        />
      ) : null}
    </section>
  );
}
