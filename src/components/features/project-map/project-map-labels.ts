/**
 * Which translation key names each node and edge kind.
 *
 * The kinds themselves are program tags from the document format; this is the
 * one place they become words a reader sees, so the legend, the inspector and
 * every accessible name stay in agreement.
 */

import { I18nKey } from "#/i18n/declaration";
import type {
  ProjectMapEdgeKind,
  ProjectMapNodeKind,
} from "#/types/project-map";
import { type ProjectMapWarningKind } from "#/utils/project-map/parse-project-map";

export const PROJECT_MAP_NODE_KIND_LABELS: Record<ProjectMapNodeKind, I18nKey> =
  {
    dir: I18nKey.PROJECT_MAP$KIND_DIR,
    module: I18nKey.PROJECT_MAP$KIND_MODULE,
    route: I18nKey.PROJECT_MAP$KIND_ROUTE,
    component: I18nKey.PROJECT_MAP$KIND_COMPONENT,
    hook: I18nKey.PROJECT_MAP$KIND_HOOK,
    service: I18nKey.PROJECT_MAP$KIND_SERVICE,
    store: I18nKey.PROJECT_MAP$KIND_STORE,
    endpoint: I18nKey.PROJECT_MAP$KIND_ENDPOINT,
    table: I18nKey.PROJECT_MAP$KIND_TABLE,
    job: I18nKey.PROJECT_MAP$KIND_JOB,
    external: I18nKey.PROJECT_MAP$KIND_EXTERNAL,
  };

export const PROJECT_MAP_EDGE_KIND_LABELS: Record<ProjectMapEdgeKind, I18nKey> =
  {
    imports: I18nKey.PROJECT_MAP$EDGE_IMPORTS,
    renders: I18nKey.PROJECT_MAP$EDGE_RENDERS,
    calls: I18nKey.PROJECT_MAP$EDGE_CALLS,
    reads: I18nKey.PROJECT_MAP$EDGE_READS,
    writes: I18nKey.PROJECT_MAP$EDGE_WRITES,
    "routes-to": I18nKey.PROJECT_MAP$EDGE_ROUTES_TO,
    publishes: I18nKey.PROJECT_MAP$EDGE_PUBLISHES,
  };

export const PROJECT_MAP_WARNING_LABELS: Record<
  ProjectMapWarningKind,
  I18nKey
> = {
  "dangling-edge": I18nKey.PROJECT_MAP$WARNING_DANGLING_EDGE,
  "duplicate-node": I18nKey.PROJECT_MAP$WARNING_DUPLICATE_NODE,
  "unknown-group": I18nKey.PROJECT_MAP$WARNING_UNKNOWN_GROUP,
  "orphan-note": I18nKey.PROJECT_MAP$WARNING_ORPHAN_NOTE,
};

/** DOM id of a node's group, so keyboard navigation can move focus to it. */
export function projectMapNodeDomId(nodeId: string): string {
  return `project-map-node-${nodeId}`;
}
