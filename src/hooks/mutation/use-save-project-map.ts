import { useMutation, useQueryClient } from "@tanstack/react-query";
import ProjectMapService from "#/api/project-map-service/project-map-service.api";
import { useActiveBackend } from "#/contexts/active-backend-context";
import { PROJECT_MAP_QUERY_KEYS } from "#/hooks/query/query-keys";
import type { ProjectMapDocument } from "#/types/project-map";
import { serializeProjectMap } from "#/utils/project-map/parse-project-map";

export const SAVE_PROJECT_MAP_MUTATION_KEY = ["save-project-map"] as const;

/**
 * Writes the arrangement back to `.openhands/project-map.json`.
 *
 * Saving is an explicit action, not a debounced side effect of dragging. The
 * file is committed and the agent edits it too, so a write is a real event
 * that belongs to a button the user pressed — a background writer would race
 * the agent and put commits in the user's working tree they never asked for.
 *
 * The last writer wins. The page's refresh is how you pick up the agent's
 * edits, and the map's header shows which commit the open document was
 * generated against so a stale one is visibly stale.
 */
export function useSaveProjectMap(conversationId: string | null = null) {
  const queryClient = useQueryClient();
  const { backend } = useActiveBackend();

  return useMutation({
    mutationKey: SAVE_PROJECT_MAP_MUTATION_KEY,
    mutationFn: (document: ProjectMapDocument) =>
      ProjectMapService.writeProjectMap(serializeProjectMap(document), {
        conversationId,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: PROJECT_MAP_QUERY_KEYS.byWorkspace(
          backend.id,
          conversationId,
        ),
      }),
  });
}
