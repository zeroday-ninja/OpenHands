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
import { projectMapNeighbors } from "#/utils/project-map/project-map-graph";
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
  onOpenInFiles: (node: PlacedProjectMapNode) => void;
}

export function ProjectMapInspector({
  document: map,
  onOpenInFiles,
}: ProjectMapInspectorProps) {
  const { t } = useTranslation("openhands");
  const selection = useProjectMapStore((state) => state.selection);
  const setSelection = useProjectMapStore((state) => state.setSelection);
  const renameNode = useProjectMapStore((state) => state.renameNode);
  const setNodeHidden = useProjectMapStore((state) => state.setNodeHidden);
  const setNodePinned = useProjectMapStore((state) => state.setNodePinned);
  const setNodeGroup = useProjectMapStore((state) => state.setNodeGroup);
  const addNote = useProjectMapStore((state) => state.addNote);
  const [renaming, setRenaming] = React.useState<string | null>(null);

  const selected = map.nodes.filter((node) => selection.includes(node.id));

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
                {node.path ?? t(PROJECT_MAP_NODE_KIND_LABELS[node.kind])}
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
          {t(PROJECT_MAP_NODE_KIND_LABELS[node.kind])}
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
        {node.path !== null && (
          <button
            type="button"
            className={PROJECT_MAP_BUTTON_CLASS}
            onClick={() => onOpenInFiles(node)}
          >
            {t(I18nKey.PROJECT_MAP$OPEN_IN_FILES)}
          </button>
        )}
      </div>

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
