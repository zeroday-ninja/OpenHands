import { useQuery } from "@tanstack/react-query";
import ProjectMapService, {
  projectMapReadErrorPath,
  projectMapUnavailableRuntimeConversation,
  projectMapUnsupportedReasonFor,
  type ProjectMapTarget,
  type ProjectMapUnsupportedReason,
  type ProjectMapWorkspace,
} from "#/api/project-map-service/project-map-service.api";
import { useActiveBackend } from "#/contexts/active-backend-context";
import { PROJECT_MAP_QUERY_KEYS } from "#/hooks/query/query-keys";
import { ensureProjectMapLayout } from "#/utils/project-map/project-map-layout";
import {
  parseProjectMap,
  projectMapRevision,
  type ProjectMapParseFailure,
  type ProjectMapWarning,
} from "#/utils/project-map/parse-project-map";
import type { PlacedProjectMapDocument } from "#/types/project-map";

/**
 * What the `/map` page is looking at. Exactly one of `document`, `failure` and
 * "the file is absent" holds, which is what lets the page render a drawing, a
 * readable complaint, or the empty state without inventing a fourth state.
 */
export interface ProjectMapView {
  /** The workspace this view was read from, which the page names on screen. */
  workspace: ProjectMapWorkspace;
  absolutePath: string;
  /**
   * Identity of the file revision this view was read from, for the editor
   * buffer's hydration check. It fingerprints the bytes, so a write by the
   * agent is a new revision even when it leaves `generated_at` and `commit`
   * alone — which the "group these three nodes" kind of edit does.
   */
  revision: string;
  /** True when there is no `.openhands/project-map.json` yet. */
  missing: boolean;
  document: PlacedProjectMapDocument | null;
  failure: ProjectMapParseFailure | null;
  warnings: ProjectMapWarning[];
}

/**
 * The project map of one workspace: the folder the user chose when there is
 * one, else the conversation's when the page is bound to one, else the
 * backend's own working directory.
 *
 * The target is passed in rather than read from the route, because the `/map`
 * page can hold a conversation the URL does not name and a folder it never
 * does (see `project-map-page.tsx`). Both are part of the query key, so
 * switching workspace is a different cache entry rather than a stale document
 * from somewhere else.
 *
 * Parsing happens in the query function rather than in the component so the
 * page re-renders against a stable object, and so a malformed document is a
 * *value* the page renders rather than an exception it has to survive. A
 * backend that cannot serve the map at all answers through
 * `unsupportedReason`, with no request made.
 *
 * Nothing here polls. The map is a committed document, and re-reading it
 * behind the user's back is exactly the surprise this feature must not have —
 * the page refetches when the user asks, or after it or the agent writes.
 */
export function useProjectMap(
  target: Pick<ProjectMapTarget, "conversationId" | "workingDir"> = {},
) {
  const { backend } = useActiveBackend();
  const conversationId = target.conversationId ?? null;
  const workingDir = target.workingDir ?? null;
  const unsupportedReason: ProjectMapUnsupportedReason | null =
    projectMapUnsupportedReasonFor(backend);

  const query = useQuery<ProjectMapView>({
    queryKey: PROJECT_MAP_QUERY_KEYS.byWorkspace(
      backend.id,
      conversationId,
      workingDir,
    ),
    queryFn: async () => {
      const file = await ProjectMapService.readProjectMap({
        conversationId,
        workingDir,
      });
      const revision = projectMapRevision(file.absolutePath, file.raw);
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
      const result = parseProjectMap(file.raw);
      if (!result.ok) {
        return {
          workspace: file.workspace,
          absolutePath: file.absolutePath,
          revision,
          missing: false,
          document: null,
          failure: result,
          warnings: [],
        };
      }
      return {
        workspace: file.workspace,
        absolutePath: file.absolutePath,
        revision,
        missing: false,
        document: ensureProjectMapLayout(result.document),
        failure: null,
        warnings: result.warnings,
      };
    },
    enabled: unsupportedReason === null,
    // A committed file: stale only once someone changes it, and the page
    // invalidates on every write of its own.
    staleTime: Infinity,
    retry: false,
    meta: { disableToast: true },
  });

  return {
    ...query,
    unsupportedReason,
    /**
     * The workspace on screen, once a read has resolved one. Null while the
     * first read is in flight and when it failed before resolving one.
     */
    workspace: query.data?.workspace ?? null,
    /**
     * The conversation whose runtime could not be reached, so the page says
     * the sandbox is gone instead of drawing an empty canvas for it.
     */
    unavailableRuntimeConversationId: projectMapUnavailableRuntimeConversation(
      query.error,
    ),
    /**
     * The file the page is looking at, whether or not reading it worked, so a
     * failure can name it. Null only when the path itself never resolved.
     */
    attemptedPath:
      query.data?.absolutePath ?? projectMapReadErrorPath(query.error),
  };
}
