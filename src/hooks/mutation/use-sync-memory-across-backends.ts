import React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import SoulService, {
  MEMORY_DOCUMENT_NAME,
  isSoulUnsupportedError,
  soulUnsupportedReasonFor,
} from "#/api/soul-service/soul-service.api";
import {
  getRegisteredBackends,
  subscribeActiveBackend,
} from "#/api/backend-registry/active-store";
import type { Backend } from "#/api/backend-registry/types";
import { useActiveBackend } from "#/contexts/active-backend-context";
import { useBackendsHealth } from "#/hooks/query/use-backends-health";
import { SOUL_QUERY_KEYS } from "#/hooks/query/query-keys";

/** What one backend contributed, and what it ended up with. */
export interface MemorySyncBackendResult {
  backendId: string;
  backendName: string;
  /** Entries this backend gained from the others. */
  added: number;
  entryCount: number;
  conflicts: string[];
}

export interface MemorySyncResult {
  backends: MemorySyncBackendResult[];
  /** Backends that could not take part, and why. Never silently dropped. */
  skipped: { backendId: string; backendName: string; reason: string }[];
}

/**
 * Fold every reachable backend's memory into every other one.
 *
 * Memory is append-only, which is the whole reason this can be a sync rather
 * than a conflict: each backend is sent the others' logs and unions them by
 * entry id, so the result converges whichever order the requests complete in,
 * running it twice changes nothing, and an entry can only ever appear or stay.
 *
 * A backend that cannot take part — unreachable, disabled by the health
 * circuit breaker, Cloud, or running a server without the route — is reported
 * rather than skipped quietly. A sync that silently left one machine out is a
 * sync that leaves the user believing something that is not true.
 */
export function useSyncMemoryAcrossBackends() {
  const queryClient = useQueryClient();
  const { backend: active, orgId } = useActiveBackend();
  // The registry read straight from its store rather than through the
  // provider, for the reason `useWorkGraph` gives for doing the same: a hook
  // that throws without the provider cannot be used from a surface that an
  // embedded host mounts on its own, and this one only ever reads the list.
  const backends = React.useSyncExternalStore(
    subscribeActiveBackend,
    getRegisteredBackends,
    getRegisteredBackends,
  );
  const health = useBackendsHealth(backends);

  return useMutation({
    mutationFn: async (): Promise<MemorySyncResult> => {
      const skipped: MemorySyncResult["skipped"] = [];
      const eligible: Backend[] = [];
      for (const candidate of backends) {
        const reason = soulUnsupportedReasonFor(candidate);
        if (reason !== null) {
          skipped.push({
            backendId: candidate.id,
            backendName: candidate.name,
            reason,
          });
          continue;
        }
        if (health[candidate.id]?.disabled === true) {
          skipped.push({
            backendId: candidate.id,
            backendName: candidate.name,
            reason: "unreachable",
          });
          continue;
        }
        eligible.push(candidate);
      }

      // Read first, then write: a backend that writes before the others have
      // been read would hand its own additions back to itself, which is
      // harmless but makes the "added" counts meaningless.
      const logs: string[] = [];
      const reachable: Backend[] = [];
      await Promise.all(
        eligible.map(async (candidate) => {
          try {
            const document = await SoulService.getIdentityDocumentFrom(
              candidate,
              MEMORY_DOCUMENT_NAME,
            );
            if (document.content.trim()) logs.push(document.content);
            reachable.push(candidate);
          } catch (error) {
            skipped.push({
              backendId: candidate.id,
              backendName: candidate.name,
              reason: isSoulUnsupportedError(error)
                ? error.reason
                : "unreachable",
            });
          }
        }),
      );

      const results: MemorySyncBackendResult[] = [];
      await Promise.all(
        reachable.map(async (candidate) => {
          try {
            const merged = await SoulService.mergeMemoryInto(candidate, logs);
            results.push({
              backendId: candidate.id,
              backendName: candidate.name,
              added: merged.added,
              entryCount: merged.entry_count,
              conflicts: merged.conflicts,
            });
          } catch (error) {
            skipped.push({
              backendId: candidate.id,
              backendName: candidate.name,
              reason: isSoulUnsupportedError(error)
                ? error.reason
                : "unreachable",
            });
          }
        }),
      );

      return { backends: results, skipped };
    },
    onSuccess: async () => {
      // The active backend's memory may have grown, and the page is showing it.
      await queryClient.invalidateQueries({
        queryKey: SOUL_QUERY_KEYS.documents(active.id, orgId),
      });
    },
  });
}
