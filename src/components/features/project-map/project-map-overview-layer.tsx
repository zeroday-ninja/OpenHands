/**
 * The map's layers as blocks, drawn on the same paper as the detail.
 *
 * See `projectMapOverview` for what is drawn and why. This file only places
 * the ink: a block per layer with its name and count, a line per direction
 * between layers with its count, and the parts that belong to no layer named
 * underneath. Every block is a button; opening one is the canvas's business.
 */

import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import type { ProjectMapOverview } from "#/utils/project-map/project-map-overview";
import { projectMapEdgeGeometry } from "#/utils/project-map/project-map-visuals";

/**
 * The count line's key, resolved by i18next to its `_one`/`_other` form. The
 * declaration only names the forms, which is why this is a string.
 */
const PARTS_I18N_KEY = "PROJECT_MAP$OVERVIEW_PARTS";
/** Also a plural phrase, and so also outside the typed key enum. */
const WAITING_LAYER_I18N_KEY = "PROJECT_MAP$WAITING_LAYER";

const LABEL_SIZE = 18;
const LABEL_INSET = 18;
/** Average advance of the label font at `LABEL_SIZE`, for a width-based cut. */
const LABEL_ADVANCE = 9.5;
const PARTS_SIZE = 12;
const LINK_LABEL_SIZE = 12;
const FOLDERS_SIZE = 11;
/** The monospace advance at `FOLDERS_SIZE`. */
const FOLDERS_ADVANCE = 6.7;

function fit(text: string, width: number, advance = LABEL_ADVANCE): string {
  const room = Math.max(1, Math.floor((width - LABEL_INSET * 2) / advance));
  return text.length <= room
    ? text
    : `${text.slice(0, Math.max(1, room - 1))}…`;
}

/** Line weight grows with the count, slowly: one relation is one hairline. */
function weight(count: number): number {
  return 1 + Math.min(4, Math.log2(count));
}

function arrowhead(tip: { x: number; y: number }, direction: string): string {
  const size = 7;
  switch (direction) {
    case "right":
      return `M${tip.x} ${tip.y}l${-size} ${-size / 2}v${size}z`;
    case "left":
      return `M${tip.x} ${tip.y}l${size} ${-size / 2}v${size}z`;
    case "down":
      return `M${tip.x} ${tip.y}l${-size / 2} ${-size}h${size}z`;
    default:
      return `M${tip.x} ${tip.y}l${-size / 2} ${size}h${size}z`;
  }
}

export interface ProjectMapOverviewLayerProps {
  overview: ProjectMapOverview;
  /** A `var(--color-map-accent-N)` reference for a layer, never a colour. */
  accentOf: (groupId: string) => string;
  /** Layer id to how many of its parts a parked change names. */
  waitingLayers?: ReadonlyMap<string, number>;
  onOpen: (groupId: string) => void;
}

const NOTHING_WAITING: ReadonlyMap<string, number> = new Map();

export function ProjectMapOverviewLayer({
  overview,
  accentOf,
  waitingLayers = NOTHING_WAITING,
  onOpen,
}: ProjectMapOverviewLayerProps) {
  const { t } = useTranslation("openhands");
  const byId = new Map(overview.blocks.map((block) => [block.group.id, block]));
  const labelOf = (groupId: string) =>
    byId.get(groupId)?.group.label ?? groupId;

  return (
    <g
      data-testid="project-map-overview"
      role="group"
      aria-label={t(I18nKey.PROJECT_MAP$OVERVIEW_LABEL)}
    >
      {/* Lines first, so the blocks sit on them. */}
      {overview.links.map((link) => {
        const from = byId.get(link.from);
        const to = byId.get(link.to);
        if (from === undefined || to === undefined) return null;
        const geometry = projectMapEdgeGeometry(from, to);
        const accent = accentOf(link.from);
        const title = t(I18nKey.PROJECT_MAP$OVERVIEW_RELATIONS, {
          count: link.count,
          from: labelOf(link.from),
          to: labelOf(link.to),
        });
        return (
          <g
            key={link.key}
            data-testid={`project-map-overview-link-${link.key}`}
          >
            <title>{title}</title>
            <path
              d={geometry.d}
              fill="none"
              stroke={accent}
              strokeOpacity={0.7}
              strokeWidth={weight(link.count)}
              strokeLinejoin="round"
            />
            <path
              d={arrowhead(geometry.tip, geometry.direction)}
              fill={accent}
            />
            <text
              x={geometry.label.x}
              y={geometry.label.y - 4}
              textAnchor="middle"
              fontSize={LINK_LABEL_SIZE}
              paintOrder="stroke"
              strokeWidth={4}
              strokeLinejoin="round"
              className="fill-text-secondary stroke-canvas-base font-mono"
            >
              {link.count}
            </text>
          </g>
        );
      })}

      {overview.blocks.map((block) => {
        const accent = accentOf(block.group.id);
        return (
          <g
            key={block.group.id}
            data-testid={`project-map-overview-block-${block.group.id}`}
            data-count={block.count}
            data-where={block.where}
            data-waiting={waitingLayers.get(block.group.id) ?? undefined}
            role="button"
            tabIndex={0}
            aria-label={`${block.group.label} — ${t(I18nKey.PROJECT_MAP$OVERVIEW_OPEN)}`}
            className="cursor-pointer outline-none focus-visible:[&>rect]:stroke-2"
            onClick={() => onOpen(block.group.id)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              onOpen(block.group.id);
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <rect
              x={block.x}
              y={block.y}
              width={block.width}
              height={block.height}
              rx={8}
              fill={accent}
              fillOpacity={0.12}
              stroke={accent}
              strokeWidth={1.5}
            />
            {/* A layer holding work that stopped to ask a person says so
                where the work is, rather than only in the rail. */}
            {(waitingLayers.get(block.group.id) ?? 0) > 0 && (
              <circle
                cx={block.x + block.width - 16}
                cy={block.y + 16}
                r={7}
                className="fill-warning stroke-canvas-base"
                strokeWidth={2}
              >
                <title>
                  {t(WAITING_LAYER_I18N_KEY, {
                    count: waitingLayers.get(block.group.id) ?? 0,
                  })}
                </title>
              </circle>
            )}
            <text
              x={block.x + LABEL_INSET}
              y={block.y + 48}
              fontSize={LABEL_SIZE}
              fontWeight={600}
              className="pointer-events-none fill-foreground"
            >
              {fit(block.group.label, block.width)}
            </text>
            <text
              x={block.x + LABEL_INSET}
              y={block.y + 78}
              fontSize={PARTS_SIZE}
              className="pointer-events-none fill-muted"
            >
              {t(PARTS_I18N_KEY, { count: block.count })}
            </text>
            {/* The repository's own words under the analysis's name: a
                layer called "Research engine" is recognised by
                `server/{research/, engine.js}` before it is by its label. */}
            {block.where !== "" && (
              <text
                x={block.x + LABEL_INSET}
                y={block.y + 100}
                fontSize={FOLDERS_SIZE}
                className="pointer-events-none fill-muted font-mono"
              >
                {fit(block.where, block.width, FOLDERS_ADVANCE)}
              </text>
            )}
          </g>
        );
      })}

      {overview.ungrouped > 0 && overview.bounds !== null && (
        <text
          data-testid="project-map-overview-ungrouped"
          x={0}
          y={overview.bounds.height + 28}
          fontSize={PARTS_SIZE}
          className="fill-muted"
        >
          {t(I18nKey.PROJECT_MAP$OVERVIEW_UNGROUPED, {
            count: overview.ungrouped,
          })}
        </text>
      )}
    </g>
  );
}
