import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import { extensionModuleEmptyStateClassName } from "#/utils/extension-module-card-classes";

/**
 * The installed package published an automation interface this build refuses.
 *
 * A deployment with no automation interface and one whose manifest was
 * rejected look identical from outside: no nav entry, and a page that will not
 * open. Only one of them is something to go and fix, and the difference lived
 * in a browser-console warning nobody reads. So the page that would have
 * rendered says which it is, and names the reason.
 */
export function RejectedManifestNotice({ reason }: { reason: string }) {
  const { t } = useTranslation("openhands");

  return (
    <div
      data-testid="automation-manifest-rejected"
      className={extensionModuleEmptyStateClassName}
    >
      <h2 className="text-sm font-semibold text-contrast">
        {t(I18nKey.AUTOMATIONS$MANIFEST_REJECTED_TITLE)}
      </h2>
      <p className="mt-2 text-sm text-tertiary-light">
        {t(I18nKey.AUTOMATIONS$MANIFEST_REJECTED_BODY)}
      </p>
      {/* The validator's own words. They name the field, which is the only
          part that makes this actionable rather than just alarming. */}
      <pre
        data-testid="automation-manifest-rejected-reason"
        className="mt-3 overflow-x-auto whitespace-pre-wrap text-left font-mono text-xs text-muted"
      >
        {reason}
      </pre>
    </div>
  );
}
