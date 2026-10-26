import { screen } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vitest";
import { renderWithProviders } from "../../../../test-utils";
import { ProjectMapInspector } from "#/components/features/project-map/project-map-inspector";
import { useProjectMapStore } from "#/stores/project-map-store";
import {
  PROJECT_MAP_VERSION,
  type PlacedProjectMapDocument,
} from "#/types/project-map";
import { defaultProjectMapCanvas } from "#/utils/project-map/project-map-authoring";

const DOCUMENT: PlacedProjectMapDocument = {
  version: PROJECT_MAP_VERSION,
  generated_at: null,
  commit: null,
  groups: [{ id: "web", label: "Web", accent: "1", collapsed: false }],
  nodes: [
    {
      id: "agent:17",
      kind: "service",
      label: "Reviewing HAZARD",
      path: null,
      group: "web",
      summary: "finished · accepted",
      size: 400,
      x: 0,
      y: 0,
      pinned: false,
      hidden: false,
      tags: ["agent", "finished"],
    },
  ],
  edges: [],
  notes: [],
  canvas: defaultProjectMapCanvas(),
};

describe("the selection panel", () => {
  beforeEach(() => {
    useProjectMapStore.getState().reset();
    useProjectMapStore.getState().hydrate("revision-1", DOCUMENT);
    useProjectMapStore.getState().setSelection(["agent:17"]);
  });

  it("reads a drawing it cannot change, and offers no edits to it", () => {
    // Arrange: the live work graph is assembled on every fetch, so renaming
    // or pinning one of its plates would write about a node the committed
    // file has never heard of.
    renderWithProviders(
      <ProjectMapInspector document={DOCUMENT} editable={false} />,
    );

    // Assert: what the thing is, with nothing that would edit the file.
    expect(screen.getByTestId("project-map-inspector")).toHaveTextContent(
      "Reviewing HAZARD",
    );
    expect(screen.queryByTestId("project-map-toggle-hidden")).toBeNull();
    expect(screen.queryByTestId("project-map-add-note")).toBeNull();
    expect(screen.queryByTestId("project-map-group-select")).toBeNull();
  });

  it("offers them on the map the page can save", () => {
    renderWithProviders(<ProjectMapInspector document={DOCUMENT} />);

    expect(screen.getByTestId("project-map-toggle-hidden")).toBeInTheDocument();
    expect(screen.getByTestId("project-map-group-select")).toBeInTheDocument();
  });
});
