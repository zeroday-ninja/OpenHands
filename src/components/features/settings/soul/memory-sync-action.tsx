/**
 * Folding several backends' memory into each other.
 *
 * Only offered when there is more than one backend to fold: a button that can
 * only ever sync a machine with itself is a button that teaches people the
 * feature does nothing.
 */

import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import { useActiveBackendContext } from "#/contexts/active-backend-context";
import { soulUnsupportedReasonFor } from "#/api/soul-service/soul-service.api";
import { useSyncMemoryAcrossBackends } from "#/hooks/mutation/use-sync-memory-across-backends";
import { BrandButton } from "#/components/features/settings/brand-button";

export function MemorySyncAction() {
  const { t } = useTranslation("openhands");
  const { backends } = useActiveBackendContext();
  const sync = useSyncMemoryAcrossBackends();

  const eligible = backends.filter(
    (backend) => soulUnsupportedReasonFor(backend) === null,
  );
  if (eligible.length < 2) return null;

  const result = sync.data;
  const conflicts = result?.backends.flatMap((entry) => entry.conflicts) ?? [];

  return (
    <div data-testid="memory-sync" className="flex flex-col gap-2">
      <p className="text-xs text-muted">
        {t(I18nKey.SETTINGS$IDENTITY_MEMORY_SYNC_DESCRIPTION)}
      </p>
      <BrandButton
        type="button"
        variant="secondary"
        testId="memory-sync-button"
        isDisabled={sync.isPending}
        onClick={() => sync.mutate()}
      >
        {t(
          sync.isPending
            ? I18nKey.SETTINGS$IDENTITY_MEMORY_SYNCING
            : I18nKey.SETTINGS$IDENTITY_MEMORY_SYNC,
        )}
      </BrandButton>

      {result && (
        <ul data-testid="memory-sync-result" className="flex flex-col gap-0.5">
          {result.backends.map((entry) => (
            <li key={entry.backendId} className="text-xs text-muted">
              {t(I18nKey.SETTINGS$IDENTITY_MEMORY_SYNC_BACKEND, {
                backend: entry.backendName,
                added: entry.added,
                total: entry.entryCount,
              })}
            </li>
          ))}
          {/* A backend left out is stated. A sync that silently skipped a
              machine is a sync that leaves the user believing something
              untrue about where their memory is. */}
          {result.skipped.map((entry) => (
            <li
              key={entry.backendId}
              data-testid="memory-sync-skipped"
              className="text-xs text-feedback-warning"
            >
              {t(I18nKey.SETTINGS$IDENTITY_MEMORY_SYNC_SKIPPED, {
                backend: entry.backendName,
                reason: entry.reason,
              })}
            </li>
          ))}
          {conflicts.length > 0 && (
            <li
              data-testid="memory-sync-conflicts"
              className="text-xs text-feedback-warning"
            >
              {t(I18nKey.SETTINGS$IDENTITY_MEMORY_SYNC_CONFLICTS, {
                count: conflicts.length,
              })}
            </li>
          )}
        </ul>
      )}

      {sync.isError && (
        <p
          data-testid="memory-sync-error"
          className="text-xs text-feedback-error"
        >
          {t(I18nKey.SETTINGS$IDENTITY_MEMORY_SYNC_ERROR)}
        </p>
      )}
    </div>
  );
}
