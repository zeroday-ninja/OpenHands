import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import type { SoulUnsupportedReason } from "#/api/soul-service/soul.types";
import { extensionModuleEmptyStateClassName } from "#/utils/extension-module-card-classes";

const REASON_COPY: Record<SoulUnsupportedReason, I18nKey> = {
  "no-backend": I18nKey.SETTINGS$SOUL_UNSUPPORTED_NO_BACKEND,
  "cloud-backend": I18nKey.SETTINGS$SOUL_UNSUPPORTED_CLOUD,
  "missing-api": I18nKey.SETTINGS$SOUL_UNSUPPORTED_MISSING_API,
};

/**
 * `/api/soul` is in no released agent server, so a backend that does not have
 * it is an ordinary outcome rather than an error. Each reason gets its own
 * sentence: the user can act on "update the agent server" and on "switch off
 * Cloud", but not on a generic failure.
 */
export function SoulUnsupportedState({
  reason,
}: {
  reason: SoulUnsupportedReason;
}) {
  const { t } = useTranslation("openhands");

  return (
    <div
      data-testid="soul-unsupported"
      data-reason={reason}
      className={extensionModuleEmptyStateClassName}
    >
      <h3 className="text-sm font-semibold text-contrast">
        {t(I18nKey.SETTINGS$SOUL_UNSUPPORTED_TITLE)}
      </h3>
      <p className="mt-2 text-sm text-tertiary-light">
        {t(REASON_COPY[reason])}
      </p>
    </div>
  );
}
