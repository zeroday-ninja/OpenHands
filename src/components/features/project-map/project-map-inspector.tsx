/**
 * What is selected, and what you can do about it.
 *
 * The edge lists are the point of this panel: they are how you walk the graph
 * without hunting for a line on the canvas, and every row is a button that
 * selects the node at its far end, so reading the map becomes a sequence of
 * clicks rather than a sequence of squints.
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff, MapPin, Pencil, StickyNote } from "lucide-react";
import { I18nKey } from "#/i18n/declaration";
import type {
  PlacedProjectMapDocument,
  PlacedProjectMapNode,
} from "#/types/project-map";
import {
  projectMapNeighbors,
  resolveProjectMapSelection,
} from "#/utils/project-map/project-map-graph";
import { useProjectMapStore } from "#/stores/project-map-store";
import {
  PROJECT_MAP_BUTTON_CLASS,
  PROJECT_MAP_EDGE_ROW_CLASS,
  PROJECT_MAP_SECTION_LABEL_CLASS,
} from "./project-map-controls";
import {
  PROJECT_MAP_EDGE_KIND_LABELS,
  PROJECT_MAP_NODE_KIND_LABELS,
} from "./project-map-labels";

const ICON_SIZE = 14;

/** Where a new note lands relative to the node it is about. */
const NOTE_OFFSET = { x: 40, y: -56 };

export interface ProjectMapInspectorProps {
  document: PlacedProjectMapDocument;
  /**
   * False when the paper shows a drawing this panel cannot change — the live
   * work graph is assembled on every fetch, so renaming or pinning one of its
   * plates would write a note about a node the committed file has never heard
   * of. It still reads: what the thing is, and what it connects to.
   */
  editable?: boolean;
  /**
   * True when the plates borrowed their silhouettes from another vocabulary.
   *
   * The live work graph is drawn with the shapes the canvas already has: an
   * agent takes a service's outline, a cycle a module's. That loan is
   * deliberate and the legend explains it, but a *word* cannot be borrowed
   * the way a shape can — this panel was calling an agent a service. The
   * category then comes from the layer the node sits in, which the work
   * graph names for a reader.
   */
  shapesAreBorrowed?: boolean;
}

export function ProjectMapInspector({
  document: map,
  editable = true,
  shapesAreBorrowed = false,
}: ProjectMapInspectorProps) {
  const { t } = useTranslation("openhands");
  /** What sort of thing a plate is, in the vocabulary it actually belongs to. */
  const categoryOf = React.useCallback(
    (node: PlacedProjectMapNode) => {
      const layer = map.groups.find((group) => group.id === node.group)?.label;
      if (shapesAreBorrowed && layer !== undefined) return layer;
      return t(PROJECT_MAP_NODE_KIND_LABELS[node.kind]);
    },
    [map.groups, shapesAreBorrowed, t],
  );
  const selection = useProjectMapStore((state) => state.selection);
  const setSelection = useProjectMapStore((state) => state.setSelection);
  const renameNode = useProjectMapStore((state) => state.renameNode);
  const setNodeHidden = useProjectMapStore((state) => state.setNodeHidden);
  const setNodePinned = useProjectMapStore((state) => state.setNodePinned);
  const setNodeGroup = useProjectMapStore((state) => state.setNodeGroup);
  const addNote = useProjectMapStore((state) => state.addNote);
  const anchorShape = useProjectMapStore((state) => state.anchorShape);
  const removeSelected = useProjectMapStore((state) => state.removeSelected);
  const [renaming, setRenaming] = React.useState<string | null>(null);

  const resolved = resolveProjectMapSelection(map, selection);
  const selected = resolved.nodes;

  // A drawn selection is a different panel: a shape has text and a colour
  // where a node has a path and a group, and showing the node panel's empty
  // state over a box the user just clicked reads as a bug.
  if (selected.length === 0 && resolved.shapes.length > 0) {
    return (
      <div
        data-testid="project-map-inspector-shapes"
        className="flex flex-col gap-2"
      >
        <ul className="flex flex-col gap-1">
          {resolved.shapes.map((shape) => (
            <li key={shape.id} className="truncate text-sm text-foreground">
              {shape.text.trim() === "" ? shape.kind : shape.text}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-1.5">
          {resolved.shapes.length === 1 && (
            <button
              type="button"
              data-testid="project-map-shape-attach"
              className={PROJECT_MAP_BUTTON_CLASS}
              disabled={resolved.shapes[0].anchor !== null}
              onClick={() => {
                const [shape] = resolved.shapes;
                const node = map.nodes.find((candidate) =>
                  selection.includes(candidate.id),
                );
                if (node === undefined) return;
                anchorShape(shape.id, {
                  layer: "code",
                  node: node.id,
                  dx: shape.x - node.x,
                  dy: shape.y - node.y,
                });
              }}
            >
              {t(I18nKey.PROJECT_MAP$SHAPE_ATTACH)}
            </button>
          )}
          {resolved.shapes.some((shape) => shape.anchor !== null) && (
            <button
              type="button"
              data-testid="project-map-shape-detach"
              className={PROJECT_MAP_BUTTON_CLASS}
              onClick={() => {
                for (const shape of resolved.shapes) {
                  anchorShape(shape.id, null);
                }
              }}
            >
              {t(I18nKey.PROJECT_MAP$SHAPE_DETACH)}
            </button>
          )}
          <button
            type="button"
            data-testid="project-map-shape-delete"
            className={PROJECT_MAP_BUTTON_CLASS}
            onClick={() => removeSelected()}
          >
            {t(I18nKey.PROJECT_MAP$DELETE_DRAWN)}
          </button>
        </div>
      </div>
    );
  }

  if (selected.length === 0) {
    return (
      <p
        data-testid="project-map-inspector-empty"
        className="text-sm text-text-secondary"
      >
        {t(I18nKey.PROJECT_MAP$INSPECTOR_EMPTY)}
      </p>
    );
  }

  // With several nodes selected the summary of any one of them is the wrong
  // thing to show, so the panel narrows to what the actions need.
  if (selected.length > 1) {
    return (
      <ul
        data-testid="project-map-inspector-multi"
        className="flex flex-col gap-1"
      >
        {selected.map((node) => (
          <li key={node.id}>
            <button
              type="button"
              className={PROJECT_MAP_EDGE_ROW_CLASS}
              onClick={() => setSelection([node.id])}
            >
              <span className="font-medium text-foreground">{node.label}</span>
              <span className="truncate font-mono text-micro text-muted">
                {node.path ?? categoryOf(node)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  }

  const [node] = selected;
  const { inbound, outbound } = projectMapNeighbors(map.edges, node.id);
  const labelOf = (id: string) =>
    map.nodes.find((candidate) => candidate.id === id)?.label ?? id;

  return (
    <div data-testid="project-map-inspector" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className={PROJECT_MAP_SECTION_LABEL_CLASS}>
          {categoryOf(node)}
        </span>
        {renaming === node.id ? (
          <input
            // The field appears because the user pressed Rename, so it has to
            // take focus; a callback ref does that without an autoFocus prop
            // that would also fire on an unrelated remount.
            ref={(element) => element?.focus()}
            aria-label={t(I18nKey.PROJECT_MAP$RENAME)}
            defaultValue={node.label}
            className="rounded border border-border-input bg-surface px-2 py-1 text-sm text-foreground"
            onBlur={(event) => {
              renameNode(node.id, event.currentTarget.value);
              setRenaming(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") setRenaming(null);
            }}
          />
        ) : (
          <h3 className="text-base font-medium text-foreground">
            {node.label}
          </h3>
        )}
        {node.path !== null && (
          <code className="font-mono text-micro break-all text-muted">
            {node.path}
          </code>
        )}
      </div>

      <p className="text-sm leading-relaxed text-text-secondary">
        {node.summary.trim() === ""
          ? t(I18nKey.PROJECT_MAP$NODE_SUMMARY_EMPTY)
          : node.summary}
      </p>

      {editable && (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            className={PROJECT_MAP_BUTTON_CLASS}
            onClick={() => setRenaming(node.id)}
          >
            <Pencil size={ICON_SIZE} aria-hidden />
            {t(I18nKey.PROJECT_MAP$RENAME)}
          </button>
          <button
            type="button"
            data-testid="project-map-toggle-hidden"
            className={PROJECT_MAP_BUTTON_CLASS}
            onClick={() => setNodeHidden(node.id, !node.hidden)}
          >
            {node.hidden ? (
              <Eye size={ICON_SIZE} aria-hidden />
            ) : (
              <EyeOff size={ICON_SIZE} aria-hidden />
            )}
            {t(
              node.hidden
                ? I18nKey.PROJECT_MAP$SHOW_HIDDEN
                : I18nKey.PROJECT_MAP$HIDE_NODE,
            )}
          </button>
          <button
            type="button"
            className={PROJECT_MAP_BUTTON_CLASS}
            onClick={() => setNodePinned(node.id, !node.pinned)}
          >
            <MapPin size={ICON_SIZE} aria-hidden />
            {t(
              node.pinned
                ? I18nKey.PROJECT_MAP$UNPIN_NODE
                : I18nKey.PROJECT_MAP$PIN_NODE,
            )}
          </button>
          <button
            type="button"
            data-testid="project-map-add-note"
            className={PROJECT_MAP_BUTTON_CLASS}
            onClick={() =>
              addNote({
                id: `note-${Date.now().toString(36)}`,
                text: "",
                anchor: node.id,
                x: node.x + NOTE_OFFSET.x,
                y: node.y + NOTE_OFFSET.y,
              })
            }
          >
            <StickyNote size={ICON_SIZE} aria-hidden />
            {t(I18nKey.PROJECT_MAP$ADD_NOTE)}
          </button>
          {/* There is no "Open in Files" here on purpose. The Files browser is a
            view of one conversation's sandbox, mounted on the conversation
            route and keyed by its id; this page has no conversation, and the
            paths it holds are relative to the backend's working directory,
            which is the *parent* of every conversation's. Nothing reachable
            from `/map` can reveal the file, so the panel shows the path
            instead of offering a button that goes to the wrong place. */}
        </div>
      )}

      {editable && (
        <label className="flex flex-col gap-1">
          <span className={PROJECT_MAP_SECTION_LABEL_CLASS}>
            {t(I18nKey.PROJECT_MAP$GROUP)}
          </span>
          <select
            data-testid="project-map-group-select"
            value={node.group ?? ""}
            className="rounded border border-border-input bg-surface px-2 py-1 text-sm text-foreground"
            onChange={(event) =>
              setNodeGroup(
                node.id,
                event.target.value === "" ? null : event.target.value,
              )
            }
          >
            <option value="">{t(I18nKey.PROJECT_MAP$NO_GROUP)}</option>
            {map.groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.label}
              </option>
            ))}
          </select>
        </label>
      )}

      <EdgeList
        title={t(I18nKey.PROJECT_MAP$INBOUND)}
        testId="project-map-inbound"
        rows={inbound.map((edge) => ({
          id: edge.from,
          kind: t(PROJECT_MAP_EDGE_KIND_LABELS[edge.kind]),
          label: labelOf(edge.from),
        }))}
        onSelect={(id) => setSelection([id])}
      />
      <EdgeList
        title={t(I18nKey.PROJECT_MAP$OUTBOUND)}
        testId="project-map-outbound"
        rows={outbound.map((edge) => ({
          id: edge.to,
          kind: t(PROJECT_MAP_EDGE_KIND_LABELS[edge.kind]),
          label: labelOf(edge.to),
        }))}
        onSelect={(id) => setSelection([id])}
      />
      {inbound.length === 0 && outbound.length === 0 && (
        <p className="text-xs text-muted">{t(I18nKey.PROJECT_MAP$NO_EDGES)}</p>
      )}
    </div>
  );
}

function EdgeList({
  title,
  testId,
  rows,
  onSelect,
}: {
  title: string;
  testId: string;
  rows: { id: string; kind: string; label: string }[];
  onSelect: (id: string) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className={PROJECT_MAP_SECTION_LABEL_CLASS}>{title}</span>
      <ul data-testid={testId} className="flex flex-col">
        {rows.map((row, index) => (
          <li key={`${row.id}-${row.kind}-${index.toString()}`}>
            <button
              type="button"
              className={PROJECT_MAP_EDGE_ROW_CLASS}
              onClick={() => onSelect(row.id)}
            >
              <span className="font-mono text-micro text-muted">
                {row.kind}
              </span>
              <span className="truncate">{row.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
