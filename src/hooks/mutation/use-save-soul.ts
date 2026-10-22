import { useMutation, useQueryClient } from "@tanstack/react-query";
import SoulService from "#/api/soul-service/soul-service.api";
import { useActiveBackend } from "#/contexts/active-backend-context";
import { SOUL_QUERY_KEYS } from "#/hooks/query/query-keys";

/**
 * Write SOUL.md. Empty or whitespace-only content deletes the file and
 * reverts the agent to its built-in default, which is what the page's
 * "revert to default" action sends.
 *
 * The response is the identity text now in effect, so it is seeded straight
 * into the cache: the editor then reflects the server's own normalization
 * (stripped, single trailing newline) rather than what was typed.
 */
export function useSaveSoul() {
  const queryClient = useQueryClient();
  const { backend } = useActiveBackend();

  return useMutation({
    mutationFn: (content: string) => SoulService.saveSoul(content),
    onSuccess: async (data) => {
      const queryKey = SOUL_QUERY_KEYS.byBackend(backend.id);
      // Cancel first: a read that started before this save would resolve
      // after it and overwrite the response we just seeded.
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData(queryKey, data);
    },
    // The page reports success and failure itself, so the global mutation
    // toast would only stack a raw one on top.
    meta: { disableToast: true },
  });
}
