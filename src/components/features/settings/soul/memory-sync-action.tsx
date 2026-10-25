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
import { eligibleForSync } from "#/api/soul-service/soul-service.api";
import { useSyncMemoryAcrossBackends } from "#/hooks/mutation/use-sync-memory-across-backends";
import { BrandButton } from "#/components/features/settings/brand-button";

/**
 * How many conflicting ids to name before summarising the rest.
 *
 * Enough to go and find them, few enough that a sync which went badly does
 * not bury the two lines above it that say what actually synced.
 */
const CONFLICTS_SHOWN = 5;

export function MemorySyncAction() {
  const { t } = useTranslation("openhands");
  const { backends } = useActiveBackendContext();
  const sync = useSyncMemoryAcrossBackends();

  // The same question the sync and the correction path ask, answered once.
  if (eligibleForSync(backends).length < 2) return null;

  const result = sync.data;
  // Deduplicated: the same entry conflicting on three backends is one entry
  // to go and look at, and listing it three times reads as three problems.
  const conflicts = [
    ...new Set(result?.backends.flatMap((entry) => entry.conflicts) ?? []),
  ];

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
              })}{" "}
              {/* The ids, not just how many. "Open MEMORY.md to reconcile
                  them" is an instruction to search a file that may be months
                  long; these are what to search for. Ids are identifiers, so
                  there is nothing here to translate. */}
              <code
                data-testid="memory-sync-conflict-ids"
                className="font-mono break-all"
              >
                {conflicts.slice(0, CONFLICTS_SHOWN).join(", ")}
                {conflicts.length > CONFLICTS_SHOWN &&
                  ` +${conflicts.length - CONFLICTS_SHOWN}`}
              </code>
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
