import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import { SoulEditor } from "#/components/features/settings/soul/soul-editor";
import { SoulUnsupportedState } from "#/components/features/settings/soul/soul-unsupported-state";
import { BrandButton } from "#/components/features/settings/brand-button";
import { useSoul } from "#/hooks/query/use-soul";

function SoulSkeleton() {
  return (
    <div data-testid="soul-skeleton" className="flex flex-col gap-4">
      <div className="h-5 w-64 animate-pulse rounded bg-surface-raised" />
      <div className="h-72 w-full animate-pulse rounded-lg bg-surface-raised" />
    </div>
  );
}

/**
 * The user's SOUL.md: their own standing brief for the agent, applied to
 * every conversation on this agent server.
 */
export default function SoulSettingsScreen() {
  const { t } = useTranslation("openhands");
  const { data, isLoading, isError, refetch, unsupportedReason } = useSoul();

  return (
    <div data-testid="soul-settings-screen" className="flex flex-col gap-6">
      <div className="flex max-w-2xl flex-col gap-2">
        <p className="text-sm text-tertiary-light">
          {t(I18nKey.SETTINGS$SOUL_DESCRIPTION)}
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
            {t(I18nKey.SETTINGS$SOUL_LOAD_ERROR)}
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
        <SoulEditor soul={data} />
      )}
    </div>
  );
}
