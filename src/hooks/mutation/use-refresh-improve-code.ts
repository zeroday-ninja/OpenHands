import { useMutation, useQueryClient } from "@tanstack/react-query";
import AutomationService from "#/api/automation-service/automation-service.api";
import { useActiveBackend } from "#/contexts/active-backend-context";
import { AUTOMATION_DETAIL_QUERY_KEY } from "#/hooks/query/use-automation-detail";
import { AUTOMATIONS_QUERY_KEY } from "#/hooks/query/use-automations";
import { IMPROVE_QUERY_KEYS } from "#/hooks/query/query-keys";

/**
 * Repackage one program's runner from the service's current preset code.
 *
 * A program's code is packaged when the program is created, so every later
 * fix to how a cycle works reaches only newer programs. This is how an
 * existing program catches up without being deleted and rebuilt, which would
 * cost its cycle history — and the history is the rotation cursor, so
 * rebuilding silently rewinds the program to its first repository.
 *
 * The rotation is invalidated rather than written from the response: the
 * answer is the automation record, and whether the code is now current is the
 * rotation's judgement to make, not this hook's to assume.
 */
export function useRefreshImproveCode(automationId: string) {
  const queryClient = useQueryClient();
  const active = useActiveBackend();

  return useMutation({
    mutationFn: () => AutomationService.refreshImproveCode(automationId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: IMPROVE_QUERY_KEYS.rotation(
          automationId,
          active.backend.id,
          active.orgId ?? null,
        ),
      });
      queryClient.invalidateQueries({ queryKey: AUTOMATION_DETAIL_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: AUTOMATIONS_QUERY_KEY });
    },
  });
}
