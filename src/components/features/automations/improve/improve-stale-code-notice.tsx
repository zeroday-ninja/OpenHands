import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { I18nKey } from "#/i18n/declaration";
import { useRefreshImproveCode } from "#/hooks/mutation/use-refresh-improve-code";
import { BrandButton } from "#/components/features/settings/brand-button";

/**
 * This program is running code from before the current build, and can catch up.
 *
 * A program's runner is packaged once, when the program is created, so every
 * later fix to how a cycle works reaches only newer programs. Nothing said so,
 * which made "this does not work for me" and "my program predates it"
 * indistinguishable — including for the rule that a cycle reads the user's own
 * corrections every time, which an older runner does not do at all.
 *
 * Nothing is shown when the service did not answer. An automation service from
 * before this landed sends no verdict, and silence there means it has nothing
 * to say, not that the program is out of date.
 */
export function ImproveStaleCodeNotice({
  automationId,
  isCurrent,
}: {
  automationId: string;
  isCurrent: boolean | undefined;
}) {
  const { t } = useTranslation("openhands");
  const refresh = useRefreshImproveCode(automationId);

  if (isCurrent !== false) return null;

  return (
    <div
      data-testid="improve-stale-code-notice"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3"
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-contrast">
          {t(I18nKey.AUTOMATIONS$IMPROVE$STALE_CODE_TITLE)}
        </p>
        <p className="mt-0.5 text-xs text-muted">
          {t(I18nKey.AUTOMATIONS$IMPROVE$STALE_CODE_BODY)}
        </p>
        {refresh.isError ? (
          <p
            data-testid="improve-stale-code-error"
            className="mt-1 text-xs text-feedback-error"
          >
            {t(I18nKey.AUTOMATIONS$IMPROVE$STALE_CODE_FAILED)}
          </p>
        ) : null}
      </div>
      <BrandButton
        testId="improve-refresh-code"
        type="button"
        variant="secondary"
        isDisabled={refresh.isPending}
        onClick={() => refresh.mutate()}
        startContent={<RefreshCw className="size-4" aria-hidden />}
      >
        {refresh.isPending
          ? t(I18nKey.AUTOMATIONS$IMPROVE$STALE_CODE_UPDATING)
          : t(I18nKey.AUTOMATIONS$IMPROVE$STALE_CODE_ACTION)}
      </BrandButton>
    </div>
  );
}
