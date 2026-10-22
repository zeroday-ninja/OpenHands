import { useTranslation } from "react-i18next";
import { ArrowRight, Sparkles } from "lucide-react";
import { I18nKey } from "#/i18n/declaration";
import { NavigationLink } from "#/components/shared/navigation-link";
import { improveProgramPath } from "#/utils/improve-program";
import { SectionCard } from "./section-card";

/**
 * The detail page's way into a program's dashboard. A program's interesting
 * state — its rotation and its cycles — is too large for this page, so this
 * section explains what the automation is and links to it.
 */
export function ImproveProgramSection({
  automationId,
}: {
  automationId: string;
}) {
  const { t } = useTranslation("openhands");

  return (
    <SectionCard
      icon={<Sparkles className="size-4" aria-hidden />}
      title={t(I18nKey.AUTOMATIONS$IMPROVE$SECTION_TITLE)}
    >
      <p className="text-sm text-muted">
        {t(I18nKey.AUTOMATIONS$IMPROVE$DESCRIPTION)}
      </p>
      <NavigationLink
        to={improveProgramPath(automationId)}
        data-testid="improve-program-link"
        className="mt-3 inline-flex items-center gap-1 text-sm text-primary hover:underline"
      >
        {t(I18nKey.AUTOMATIONS$IMPROVE$SECTION_LINK)}
        <ArrowRight className="size-3.5" aria-hidden />
      </NavigationLink>
    </SectionCard>
  );
}
