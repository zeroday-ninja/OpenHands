import { useTranslation } from "react-i18next";
import { MemorySyncAction } from "./memory-sync-action";
import { I18nKey } from "#/i18n/declaration";
import type { IdentitySetResponse } from "#/api/soul-service/soul.types";
import { IdentityDocumentSection } from "#/components/features/settings/soul/identity-document-section";
import { extensionModuleEmptyStateClassName } from "#/utils/extension-module-card-classes";

/**
 * The user's identity, as the set of documents the agent server declares.
 *
 * The order is the server's: identity, then voice, then recent memory, then
 * examples, then raw data. It is the order a prompt reads them in, and
 * re-sorting it here would quietly disagree with the build that does the
 * reading.
 */
export function IdentityDocumentsEditor({ set }: { set: IdentitySetResponse }) {
  const { t } = useTranslation("openhands");

  if (set.documents.length === 0) {
    return (
      <div
        data-testid="identity-documents-none"
        className={extensionModuleEmptyStateClassName}
      >
        <p className="text-sm text-tertiary-light">
          {t(I18nKey.SETTINGS$IDENTITY_DOCUMENTS_NONE)}
        </p>
      </div>
    );
  }

  return (
    <div
      data-testid="identity-documents-editor"
      className="flex max-w-2xl flex-col gap-4"
    >
      <p className="flex min-w-0 flex-wrap items-baseline gap-1 text-xs text-muted">
        {t(I18nKey.SETTINGS$IDENTITY_DIRECTORY_LABEL)}
        <code data-testid="identity-directory" className="truncate font-mono">
          {set.directory}
        </code>
      </p>
      <MemorySyncAction />

      {set.documents.map((doc) => (
        <IdentityDocumentSection key={doc.name} document={doc} />
      ))}
    </div>
  );
}
