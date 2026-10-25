/**
 * Take the work graph away and check it.
 *
 * The graph is assembled on every fetch and never written to disk, which is
 * right for a live view and leaves nothing to audit with. Milestone 3 asks for
 * an export "with a digest anyone can recompute" — so this downloads the
 * canonical document and shows the digest beside the button, because a digest
 * only means something if the person holding the file can read it from
 * somewhere other than the file.
 *
 * It renders only on the work layer, and only once something has answered: a
 * download button that produces an empty attestation invites a reader to
 * conclude there was no work.
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { Download } from "lucide-react";
import { I18nKey } from "#/i18n/declaration";
import type {
  MergedWorkGraph,
  WorkGraphContribution,
} from "#/utils/work-graph/work-graph-merge";
import {
  canonicalWorkGraphDocument,
  workGraphDigest,
  workGraphExport,
} from "#/utils/work-graph/work-graph-export";
import { PROJECT_MAP_BUTTON_CLASS } from "./project-map-controls";

const ICON_SIZE = 14;

export interface ProjectMapWorkExportProps {
  graph: MergedWorkGraph;
  contributions: readonly WorkGraphContribution[];
}

export function ProjectMapWorkExport({
  graph,
  contributions,
}: ProjectMapWorkExportProps) {
  const { t } = useTranslation("openhands");
  const [digest, setDigest] = React.useState<string | null>(null);

  if (graph.nodes.length === 0) return null;

  const save = async () => {
    const document_ = canonicalWorkGraphDocument(
      workGraphExport(graph, contributions),
    );
    // Computed from the same string that is written, not from the graph: a
    // digest taken over anything but the delivered bytes is a digest of
    // something nobody has.
    setDigest(await workGraphDigest(document_));
    const url = URL.createObjectURL(
      new Blob([document_], { type: "application/json" }),
    );
    const link = window.document.createElement("a");
    link.href = url;
    link.download = "work-graph.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      data-testid="project-map-work-export"
      className="flex flex-wrap items-center gap-2"
    >
      <button
        type="button"
        data-testid="project-map-work-export-button"
        className={PROJECT_MAP_BUTTON_CLASS}
        onClick={save}
      >
        <Download size={ICON_SIZE} aria-hidden />
        {t(I18nKey.PROJECT_MAP$WORK_EXPORT)}
      </button>
      {digest && (
        // Selectable, not a toast: the reader's next action is to compare it
        // with what they compute from the file themselves.
        <code
          data-testid="project-map-work-export-digest"
          className="select-all font-mono text-micro text-muted"
        >
          {digest}
        </code>
      )}
    </div>
  );
}
