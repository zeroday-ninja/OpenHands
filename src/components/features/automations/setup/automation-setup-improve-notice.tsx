import { useTranslation } from "react-i18next";
import { ArrowRight, Sparkles } from "lucide-react";
import { I18nKey } from "#/i18n/declaration";
import { NavigationLink } from "#/components/shared/navigation-link";
import { improveProgramPath } from "#/utils/improve-program";

/**
 * What this form cannot say about an improvement program, and where it is
 * said instead.
 *
 * The generic editor still owns this automation's name, schedule and timeout.
 * Everything that makes it a program — which profile builds, which runtimes
 * review, what it rotates over, its branch prefix, its file cap, whether it
 * opens a pull request, its standing focus — is not a field here, and a form
 * that shows none of it reads as if the program had no such settings.
 */
export function AutomationSetupImproveNotice({
  automationId,
}: {
  automationId: string;
}) {
  const { t } = useTranslation("openhands");

  return (
    <div
      data-testid="automation-setup-improve-notice"
      className="rounded-2xl border border-border bg-surface px-5 py-4"
    >
      <h3 className="flex items-center gap-2 text-sm font-medium text-content">
        <Sparkles className="size-4 text-muted" aria-hidden />
        {t(I18nKey.AUTOMATIONS$IMPROVE$SETUP_NOTICE_TITLE)}
      </h3>
      <p className="mt-2 text-sm text-muted">
        {t(I18nKey.AUTOMATIONS$IMPROVE$SETUP_NOTICE_BODY)}
      </p>
      <NavigationLink
        to={improveProgramPath(automationId)}
        data-testid="automation-setup-improve-link"
        className="mt-3 inline-flex items-center gap-1 text-sm text-primary hover:underline"
      >
        {t(I18nKey.AUTOMATIONS$IMPROVE$SETUP_NOTICE_LINK)}
        <ArrowRight className="size-3.5" aria-hidden />
      </NavigationLink>
    </div>
  );
}
