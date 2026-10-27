import { useMutation, useQueryClient } from "@tanstack/react-query";
import WorkbenchService from "#/api/workbench-service/workbench-service.api";
import { useActiveBackend } from "#/contexts/active-backend-context";
import { WORKBENCH_QUERY_KEYS } from "#/hooks/query/query-keys";
import type { WorkbenchDocument } from "#/types/workbench";
import { serializeWorkbench } from "#/utils/workbench/parse-workbench";

export const SAVE_WORKBENCH_MUTATION_KEY = ["save-workbench"] as const;

/**
 * Writes the document back to `.openhands/workbench.json`.
 *
 * The workbench leans towards doing things without being asked, so unlike the
 * project map it saves on its own, a moment after the last edit (see the
 * page's autosave). The last writer wins, and the page re-reads after an
 * agent's write; a conflict is visible as a change, never silent.
 */
export function useSaveWorkbench(conversationId: string | null = null) {
  const queryClient = useQueryClient();
  const { backend } = useActiveBackend();

  return useMutation({
    mutationKey: SAVE_WORKBENCH_MUTATION_KEY,
    mutationFn: (document: WorkbenchDocument) =>
      WorkbenchService.writeWorkbench(serializeWorkbench(document), {
        conversationId,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: WORKBENCH_QUERY_KEYS.byWorkspace(backend.id, conversationId),
      }),
  });
}
