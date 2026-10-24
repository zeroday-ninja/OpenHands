import { useQuery } from "@tanstack/react-query";
import SoulService, {
  isSoulUnsupportedError,
  soulUnsupportedReasonFor,
} from "#/api/soul-service/soul-service.api";
import type { SoulUnsupportedReason } from "#/api/soul-service/soul.types";
import { useActiveBackend } from "#/contexts/active-backend-context";
import { getErrorStatus } from "#/hooks/query/use-settings";
import { SOUL_QUERY_KEYS } from "#/hooks/query/query-keys";

/**
 * The user's identity documents on the active agent server, in the order the
 * server reads them.
 *
 * `unsupportedReason` works exactly as it does in `useSoul`: it is answered
 * without a request for a Cloud backend or no backend at all, and from the 404
 * an agent server older than `/api/soul/documents` returns. That outcome is
 * ordinary rather than an error, so the query neither retries nor toasts it.
 */
export function useIdentityDocuments() {
  const { backend, orgId } = useActiveBackend();
  const backendReason = soulUnsupportedReasonFor(backend);

  const query = useQuery({
    queryKey: SOUL_QUERY_KEYS.documents(backend.id, orgId),
    queryFn: () => SoulService.getIdentityDocuments(),
    enabled: backendReason === null,
    staleTime: 60 * 1000,
    // Only a request that never got an answer is worth repeating: a server
    // without the route answers the same way forever.
    retry: (failureCount, error) =>
      !isSoulUnsupportedError(error) &&
      getErrorStatus(error) === undefined &&
      failureCount < 2,
    meta: { disableToast: true },
  });

  const unsupportedReason: SoulUnsupportedReason | null =
    backendReason ??
    (isSoulUnsupportedError(query.error) ? query.error.reason : null);

  return { ...query, unsupportedReason };
}
