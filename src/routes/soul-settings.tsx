import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import { IdentityDocumentsEditor } from "#/components/features/settings/soul/identity-documents-editor";
import { SoulUnsupportedState } from "#/components/features/settings/soul/soul-unsupported-state";
import { BrandButton } from "#/components/features/settings/brand-button";
import { useIdentityDocuments } from "#/hooks/query/use-identity-documents";

function SoulSkeleton() {
  return (
    <div data-testid="soul-skeleton" className="flex flex-col gap-4">
      <div className="h-5 w-64 animate-pulse rounded bg-surface-raised" />
      <div className="h-72 w-full animate-pulse rounded-lg bg-surface-raised" />
    </div>
  );
}

/**
 * The user's identity: their own standing brief for the agent, applied to
 * every conversation on this agent server.
 *
 * It is a set of documents rather than one file, because "who is this person"
 * was never going to answer "how do they write" or "what have we already
 * learned". Each document is written and cleared on its own here, in the
 * order the agent server reads them.
 */
export default function SoulSettingsScreen() {
  const { t } = useTranslation("openhands");
  const { data, isLoading, isError, refetch, unsupportedReason } =
    useIdentityDocuments();

  return (
    <div data-testid="soul-settings-screen" className="flex flex-col gap-6">
      <div className="flex max-w-2xl flex-col gap-2">
        <p className="text-sm text-tertiary-light">
          {t(I18nKey.SETTINGS$SOUL_DESCRIPTION)}
        </p>
        <p className="text-sm text-tertiary-light">
          {t(I18nKey.SETTINGS$IDENTITY_DOCUMENTS_DESCRIPTION)}
        </p>
        <p className="text-sm text-tertiary-light">
          {t(I18nKey.SETTINGS$SOUL_ACP_NOTE)}
        </p>
      </div>

      {unsupportedReason ? (
        <SoulUnsupportedState reason={unsupportedReason} />
      ) : isLoading ? (
        <SoulSkeleton />
      ) : isError || !data ? (
        <div data-testid="soul-load-error" className="flex flex-col gap-3">
          <p className="text-sm text-feedback-error">
            {t(I18nKey.SETTINGS$IDENTITY_LOAD_ERROR)}
          </p>
          <BrandButton
            testId="soul-retry-button"
            type="button"
            variant="secondary"
            className="self-start"
            onClick={() => void refetch()}
          >
            {t(I18nKey.AUTOMATIONS$ERROR_RETRY)}
          </BrandButton>
        </div>
      ) : (
        <IdentityDocumentsEditor set={data} />
      )}
    </div>
  );
}
