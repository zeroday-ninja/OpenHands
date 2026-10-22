import { useQuery } from "@tanstack/react-query";
import ProjectMapService, {
  projectMapReadErrorPath,
  projectMapUnsupportedReasonFor,
  type ProjectMapUnsupportedReason,
} from "#/api/project-map-service/project-map-service.api";
import { useActiveBackend } from "#/contexts/active-backend-context";
import { PROJECT_MAP_QUERY_KEYS } from "#/hooks/query/query-keys";
import { ensureProjectMapLayout } from "#/utils/project-map/project-map-layout";
import {
  parseProjectMap,
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
  absolutePath: string;
  /** True when there is no `.openhands/project-map.json` yet. */
  missing: boolean;
  document: PlacedProjectMapDocument | null;
  failure: ProjectMapParseFailure | null;
  warnings: ProjectMapWarning[];
}

/**
 * The project map for the active workspace.
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
export function useProjectMap(conversationId: string | null = null) {
  const { backend } = useActiveBackend();
  const unsupportedReason: ProjectMapUnsupportedReason | null =
    projectMapUnsupportedReasonFor(backend);

  const query = useQuery<ProjectMapView>({
    queryKey: PROJECT_MAP_QUERY_KEYS.byWorkspace(backend.id, conversationId),
    queryFn: async () => {
      const file = await ProjectMapService.readProjectMap({ conversationId });
      if (file.raw === null) {
        return {
          absolutePath: file.absolutePath,
          missing: true,
          document: null,
          failure: null,
          warnings: [],
        };
      }
      const result = parseProjectMap(file.raw);
      if (!result.ok) {
        return {
          absolutePath: file.absolutePath,
          missing: false,
          document: null,
          failure: result,
          warnings: [],
        };
      }
      return {
        absolutePath: file.absolutePath,
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
     * The file the page is looking at, whether or not reading it worked, so a
     * failure can name it. Null only when the path itself never resolved.
     */
    attemptedPath:
      query.data?.absolutePath ?? projectMapReadErrorPath(query.error),
  };
}
