import { useMutation, useQueryClient } from "@tanstack/react-query";
import AutomationService from "#/api/automation-service/automation-service.api";
import { useActiveBackend } from "#/contexts/active-backend-context";
import { AUTOMATION_DETAIL_QUERY_KEY } from "#/hooks/query/use-automation-detail";
import { AUTOMATIONS_QUERY_KEY } from "#/hooks/query/use-automations";
import { IMPROVE_QUERY_KEYS } from "#/hooks/query/query-keys";
import type { ImproveProgramConfig } from "#/types/improve";

/**
 * Change what one improvement program does, from its next cycle onwards.
 *
 * The answer is the new rotation, so it is written straight into the rotation
 * query rather than refetched: the user's question after a save is which
 * repository the change put up next, and the response already says.
 *
 * Saving also moves the automation's own agent profile to the new builder
 * (the service keeps the two in step), so the records that show what an
 * automation runs as are invalidated with it.
 */
export function useReplaceImproveConfig(automationId: string) {
  const queryClient = useQueryClient();
  const active = useActiveBackend();

  return useMutation({
    mutationFn: (config: ImproveProgramConfig) =>
      AutomationService.replaceImproveConfig(automationId, config),
    onSuccess: async (rotation) => {
      const queryKey = IMPROVE_QUERY_KEYS.rotation(
        automationId,
        active.backend.id,
        active.orgId ?? null,
      );
      // Cancel first: a rotation GET that started before this save would
      // resolve after it and overwrite the answer with its pre-save snapshot.
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData(queryKey, rotation);
      queryClient.invalidateQueries({ queryKey: AUTOMATION_DETAIL_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: AUTOMATIONS_QUERY_KEY });
    },
    // The form reports the service's own message next to the save button, so
    // the global mutation toast would stack a raw one on top of it.
    meta: { disableToast: true },
  });
}
