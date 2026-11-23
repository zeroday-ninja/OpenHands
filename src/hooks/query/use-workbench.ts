import { useQuery } from "@tanstack/react-query";
import WorkbenchService, {
  workbenchUnsupportedReasonFor,
  type WorkbenchUnsupportedReason,
  type WorkbenchWorkspace,
} from "#/api/workbench-service/workbench-service.api";
import { useActiveBackend } from "#/contexts/active-backend-context";
import { WORKBENCH_QUERY_KEYS } from "#/hooks/query/query-keys";
import type { WorkbenchDocument } from "#/types/workbench";
import {
  parseWorkbench,
  workbenchRevision,
} from "#/utils/workbench/parse-workbench";

/**
 * What the workbench page is looking at. Exactly one of `document`, `failure`
 * and `missing` holds, so the page can render a drawing, a readable complaint
 * or the empty state without a fourth case.
 */
export interface WorkbenchView {
  workspace: WorkbenchWorkspace;
  absolutePath: string;
  /** Fingerprint of the bytes read, for the editor buffer's hydration check. */
  revision: string;
  missing: boolean;
  document: WorkbenchDocument | null;
  failure: string | null;
  warnings: string[];
}

/**
 * The workbench document of one workspace. Nothing polls: the document is a
 * committed file, re-read when the user asks or after the page or an agent
 * writes it.
 */
export function useWorkbench(conversationId: string | null = null) {
  const { backend } = useActiveBackend();
  const unsupportedReason: WorkbenchUnsupportedReason | null =
    workbenchUnsupportedReasonFor(backend);

  const query = useQuery<WorkbenchView>({
    queryKey: WORKBENCH_QUERY_KEYS.byWorkspace(backend.id, conversationId),
    queryFn: async () => {
      const file = await WorkbenchService.readWorkbench({ conversationId });
      const revision = workbenchRevision(file.absolutePath, file.raw);
      if (file.raw === null) {
        return {
          workspace: file.workspace,
          absolutePath: file.absolutePath,
          revision,
          missing: true,
          document: null,
          failure: null,
          warnings: [],
        };
      }
      const parsed = parseWorkbench(file.raw);
      return {
        workspace: file.workspace,
        absolutePath: file.absolutePath,
        revision,
        missing: false,
        document: parsed.document,
        failure: parsed.failure,
        warnings: parsed.warnings,
      };
    },
    enabled: unsupportedReason === null,
    staleTime: Infinity,
    retry: false,
  });

  return { ...query, unsupportedReason };
}
