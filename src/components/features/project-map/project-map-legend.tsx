/**
 * The key to the drawing.
 *
 * The map spends its two visual variables on silhouette (what a node is) and
 * accent (which layer it belongs to), and on dash and head for what an edge
 * means. None of that is guessable on first sight, so the legend draws the
 * actual shapes at actual size rather than describing them in words. It lists
 * only the kinds this document uses, because a key full of shapes that are not
 * on the page is noise.
 */

import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import {
  PROJECT_MAP_EDGE_KINDS,
  PROJECT_MAP_NODE_KINDS,
  type ProjectMapDocument,
} from "#/types/project-map";
import {
  projectMapEdgeHeadPath,
  projectMapEdgeStyle,
  projectMapSilhouette,
} from "#/utils/project-map/project-map-visuals";
import {
  PROJECT_MAP_EDGE_KIND_LABELS,
  PROJECT_MAP_NODE_KIND_LABELS,
} from "./project-map-labels";
import { PROJECT_MAP_SECTION_LABEL_CLASS } from "./project-map-controls";

const SAMPLE_WIDTH = 38;
const SAMPLE_HEIGHT = 18;

export function ProjectMapLegend({
  document: map,
}: {
  document: ProjectMapDocument;
}) {
  const { t } = useTranslation("openhands");
  const usedKinds = new Set(map.nodes.map((node) => node.kind));
  const usedEdges = new Set(map.edges.map((edge) => edge.kind));

  return (
    // Open by default: the key is the one thing in the rail a first visit
    // needs before clicking anything, and a closed one reads as a heading.
    <details open data-testid="project-map-legend">
      <summary className={`${PROJECT_MAP_SECTION_LABEL_CLASS} cursor-pointer`}>
        {t(I18nKey.PROJECT_MAP$LEGEND)}
      </summary>
      <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
        {PROJECT_MAP_NODE_KINDS.filter((kind) => usedKinds.has(kind)).map(
          (kind) => {
            const silhouette = projectMapSilhouette(
              kind,
              SAMPLE_WIDTH,
              SAMPLE_HEIGHT,
            );
            return (
              <li key={kind} className="flex items-center gap-2">
                <svg
                  width={SAMPLE_WIDTH + 2}
                  height={SAMPLE_HEIGHT + 2}
                  viewBox={`-1 -1 ${SAMPLE_WIDTH + 2} ${SAMPLE_HEIGHT + 2}`}
                  aria-hidden
                  className="shrink-0"
                >
                  <path
                    d={silhouette.outline}
                    className="fill-surface stroke-text-secondary"
                    strokeWidth={1}
                    strokeDasharray={silhouette.dashed ? "3 2" : undefined}
                  />
                  {silhouette.detail !== null && (
                    <path
                      d={silhouette.detail}
                      fill="none"
                      className="stroke-muted"
                      strokeWidth={1}
                    />
                  )}
                </svg>
                <span className="text-xs text-text-secondary">
                  {t(PROJECT_MAP_NODE_KIND_LABELS[kind])}
                </span>
              </li>
            );
          },
        )}
      </ul>
      <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
        {PROJECT_MAP_EDGE_KINDS.filter((kind) => usedEdges.has(kind)).map(
          (kind) => {
            const style = projectMapEdgeStyle(kind);
            const head = projectMapEdgeHeadPath(
              style.head,
              { x: SAMPLE_WIDTH, y: SAMPLE_HEIGHT / 2 },
              "right",
            );
            return (
              <li key={kind} className="flex items-center gap-2">
                <svg
                  width={SAMPLE_WIDTH + 2}
                  height={SAMPLE_HEIGHT}
                  viewBox={`0 0 ${SAMPLE_WIDTH + 2} ${SAMPLE_HEIGHT}`}
                  aria-hidden
                  className="shrink-0"
                >
                  <path
                    d={`M0 ${SAMPLE_HEIGHT / 2}H${SAMPLE_WIDTH}`}
                    fill="none"
                    className="stroke-text-secondary"
                    strokeWidth={style.weight}
                    strokeDasharray={style.dash ?? undefined}
                  />
                  {head !== null && (
                    <path
                      d={head}
                      className={
                        style.head === "open"
                          ? "fill-canvas-base stroke-text-secondary"
                          : "fill-text-secondary stroke-text-secondary"
                      }
                      strokeWidth={1}
                    />
                  )}
                </svg>
                <span className="text-xs text-text-secondary">
                  {t(PROJECT_MAP_EDGE_KIND_LABELS[kind])}
                </span>
              </li>
            );
          },
        )}
      </ul>
    </details>
  );
}
