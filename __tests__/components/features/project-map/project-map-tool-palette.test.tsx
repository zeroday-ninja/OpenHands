import { act, fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { renderWithProviders } from "../../../../test-utils";
import { ProjectMapToolPalette } from "#/components/features/project-map/project-map-tool-palette";
import { useProjectMapStore } from "#/stores/project-map-store";
import {
  PROJECT_MAP_VERSION,
  type PlacedProjectMapDocument,
} from "#/types/project-map";
import { defaultProjectMapCanvas } from "#/utils/project-map/project-map-authoring";

const document_: PlacedProjectMapDocument = {
  version: PROJECT_MAP_VERSION,
  generated_at: null,
  commit: null,
  groups: [],
  nodes: [
    {
      id: "src/app.ts",
      kind: "module",
      label: "app",
      path: "src/app.ts",
      group: null,
      summary: "",
      size: 100,
      x: 0,
      y: 0,
      pinned: false,
      hidden: false,
      tags: [],
    },
  ],
  edges: [],
  notes: [],
  canvas: defaultProjectMapCanvas(),
};

describe("ProjectMapToolPalette", () => {
  beforeEach(() => {
    useProjectMapStore.getState().reset();
    useProjectMapStore.getState().hydrate("test-revision", document_);
  });

  it("arranges the drawing and leaves the analysis where it is", () => {
    // Arrange: a parent and a child drawn on top of each other, plus an
    // analysed node that no arrangement has any business moving.
    act(() => {
      const store = useProjectMapStore.getState();
      store.addShape({ kind: "branch", x: 500, y: 500 });
      const parent =
        useProjectMapStore.getState().document?.canvas.shapes[0].id ?? "";
      store.addShape({ kind: "branch", x: 500, y: 500, parent });
      store.clearSelection();
    });
    renderWithProviders(<ProjectMapToolPalette />);
    const nodeBefore = useProjectMapStore.getState().document?.nodes[0];

    // Act
    fireEvent.click(screen.getByTestId("project-map-layout-tree"));

    // Assert: the child moved clear of its parent, the analysed node did not
    // move at all, and the document records which arrangement is in charge.
    const after = useProjectMapStore.getState().document;
    const [first, second] = after?.canvas.shapes ?? [];
    expect(second.x).toBeGreaterThan(first.x + first.width);
    expect(after?.nodes[0]).toEqual(nodeBefore);
    expect(after?.canvas.view.layout).toBe("tree");
  });

  it("offers undo only once there is something to undo", () => {
    // Arrange
    renderWithProviders(<ProjectMapToolPalette />);
    expect(screen.getByTestId("project-map-undo")).toBeDisabled();

    // Act: draw something, then take it back.
    act(() => {
      useProjectMapStore.getState().addShape({ kind: "box", x: 0, y: 0 });
    });
    fireEvent.click(screen.getByTestId("project-map-undo"));

    // Assert: the drawing is gone and the step is available to redo. The save
    // is explicit, so without this an accidental delete is unrecoverable.
    expect(useProjectMapStore.getState().document?.canvas.shapes).toHaveLength(
      0,
    );
    expect(screen.getByTestId("project-map-redo")).not.toBeDisabled();
  });
});
