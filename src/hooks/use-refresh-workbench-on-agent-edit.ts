import { WORKBENCH_QUERY_KEYS } from "#/hooks/query/query-keys";
import { useRefreshQueryOnAgentEdit } from "#/hooks/use-refresh-project-map-on-agent-edit";
import { WORKBENCH_FILE_PATH } from "#/types/workbench";

/**
 * Re-reads the workbench document when the Architect or the PM writes it from
 * inside the bound conversation, so a "split this story" said in chat shows up
 * on the board without a refresh.
 */
export function useRefreshWorkbenchOnAgentEdit(): void {
  useRefreshQueryOnAgentEdit(WORKBENCH_FILE_PATH, WORKBENCH_QUERY_KEYS.all);
}
