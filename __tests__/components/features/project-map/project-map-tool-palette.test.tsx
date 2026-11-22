import { act, fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { renderWithProviders } from "../../../../test-utils";
import { ProjectMapToolPalette } from "#/components/features/project-map/project-map-tool-palette";
import {
  PROJECT_MAP_HISTORY_LIMIT,
  useProjectMapStore,
} from "#/stores/project-map-store";
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

  it("offers the drawing tools only when the drawing is shown", () => {
    // Arrange: a map opens in the analysis mode, where the drawn layer is
    // not on the paper; a tool was left in hand from before.
    useProjectMapStore.getState().setTool("box");
    useProjectMapStore.getState().setMode("derived");
    const { rerender } = renderWithProviders(
      <ProjectMapToolPalette mode="derived" />,
    );

    // Assert: no tools, no layouts, the tool put down; undo still there.
    expect(screen.queryByTestId("project-map-tool-box")).toBeNull();
    expect(screen.queryByTestId("project-map-layout-tree")).toBeNull();
    expect(screen.getByTestId("project-map-undo")).toBeInTheDocument();
    expect(useProjectMapStore.getState().tool).toBe("select");

    // Act: show the drawing.
    rerender(<ProjectMapToolPalette mode="both" />);

    // Assert
    expect(screen.getByTestId("project-map-tool-box")).toBeInTheDocument();
    expect(screen.getByTestId("project-map-layout-tree")).toBeInTheDocument();
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
    renderWithProviders(<ProjectMapToolPalette mode="both" />);
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
    renderWithProviders(<ProjectMapToolPalette mode="both" />);
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

  it("remembers fifty steps and no more", () => {
    // The bound is the plan's: undo exists because "the moment Delete exists
    // so does unrecoverable loss of unsaved drawing", and it is capped at
    // fifty so a long session cannot grow the history without limit.
    //
    // The cap was applied in three places and asserted nowhere, so a
    // refactor that dropped one `.slice(...)` would be invisible — and the
    // failure it would cause, a drawing session whose memory grows with
    // every stroke, is the kind nobody notices until it is bad.
    renderWithProviders(<ProjectMapToolPalette mode="both" />);
    const steps = PROJECT_MAP_HISTORY_LIMIT + 10;

    // Act: more edits than the history holds, then undo until it refuses.
    act(() => {
      for (let index = 0; index < steps; index += 1) {
        useProjectMapStore.getState().addShape({ kind: "box", x: index, y: 0 });
      }
    });
    let undone = 0;
    while (
      !(screen.getByTestId("project-map-undo") as HTMLButtonElement).disabled
    ) {
      fireEvent.click(screen.getByTestId("project-map-undo"));
      undone += 1;
      // A cap that is not applied would run until the array is exhausted, so
      // the loop needs its own ceiling to fail as an assertion rather than
      // as a timeout.
      if (undone > steps) break;
    }

    // Assert: fifty steps back, and the ten oldest shapes are still there
    // because their history was dropped rather than their content.
    expect(undone).toBe(PROJECT_MAP_HISTORY_LIMIT);
    expect(useProjectMapStore.getState().document?.canvas.shapes).toHaveLength(
      steps - PROJECT_MAP_HISTORY_LIMIT,
    );
  });
});
