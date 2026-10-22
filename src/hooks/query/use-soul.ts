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
 * The user's SOUL.md on the active agent server.
 *
 * `unsupportedReason` is the page's single source of truth for "this backend
 * cannot do this": it is answered without a request for a Cloud backend or no
 * backend at all, and from the 404 an agent server older than `/api/soul`
 * returns. The route is optional on purpose, so the query neither retries nor
 * toasts that outcome.
 */
export function useSoul() {
  const { backend } = useActiveBackend();
  const backendReason = soulUnsupportedReasonFor(backend);

  const query = useQuery({
    queryKey: SOUL_QUERY_KEYS.byBackend(backend.id),
    queryFn: () => SoulService.getSoul(),
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
