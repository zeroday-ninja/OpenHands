import React from "react";
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderWithProviders } from "../../../../test-utils";
import { ProjectMapCanvas } from "#/components/features/project-map/project-map-canvas";
import { projectMapNodeDomId } from "#/components/features/project-map/project-map-labels";
import { useProjectMapStore } from "#/stores/project-map-store";
import {
  PROJECT_MAP_VERSION,
  type PlacedProjectMapDocument,
  type PlacedProjectMapNode,
} from "#/types/project-map";
import { projectMapGroupNodeId } from "#/utils/project-map/project-map-graph";

function node(
  overrides: Partial<PlacedProjectMapNode> & { id: string },
): PlacedProjectMapNode {
  return {
    kind: "module",
    label: overrides.id,
    path: overrides.id,
    group: null,
    summary: "",
    size: 200,
    x: 0,
    y: 0,
    pinned: false,
    hidden: false,
    tags: [],
    ...overrides,
  };
}

const document_: PlacedProjectMapDocument = {
  version: PROJECT_MAP_VERSION,
  generated_at: null,
  commit: "abc1234",
  groups: [{ id: "web", label: "Web app", accent: "1", collapsed: false }],
  nodes: [
    node({ id: "left", x: 0, y: 0, group: "web" }),
    node({ id: "right", x: 400, y: 0, group: "web" }),
    node({ id: "below", x: 0, y: 300 }),
    node({ id: "noise", x: 800, y: 0, hidden: true }),
  ],
  edges: [{ from: "left", to: "right", kind: "calls", label: null }],
  notes: [],
};

/**
 * The page reads the open document from the store, so the harness does too —
 * otherwise an edit made through a store action (collapsing a group, revealing
 * hidden nodes) would never reach the drawing under test.
 */
function Harness() {
  const frameRef = React.useRef<SVGSVGElement | null>(null);
  const open = useProjectMapStore((state) => state.document);
  if (open === null) return null;
  return <ProjectMapCanvas document={open} frameRef={frameRef} />;
}

function renderCanvas() {
  useProjectMapStore.getState().hydrate("test-revision", document_);
  return renderWithProviders(<Harness />);
}

describe("ProjectMapCanvas", () => {
  beforeEach(() => {
    useProjectMapStore.getState().reset();
  });

  afterEach(() => {
    useProjectMapStore.getState().reset();
  });

  it("leaves a hidden node out of the drawing until the user asks to see it", () => {
    // Arrange / Act
    renderCanvas();

    // Assert
    expect(screen.queryByTestId("project-map-node-noise")).toBeNull();

    // Act: the user turns hidden nodes back on.
    act(() => {
      useProjectMapStore.getState().toggleShowHidden();
    });

    // Assert
    expect(screen.getByTestId("project-map-node-noise")).toBeInTheDocument();
  });

  it("reaches a node with the keyboard, steps to its neighbour, and selects it", async () => {
    // Arrange
    const user = userEvent.setup();
    renderCanvas();

    // Act: tab lands on the first plate, the right arrow steps to the next.
    await user.tab();
    expect(screen.getByTestId("project-map-node-left")).toHaveFocus();
    await user.keyboard("{ArrowRight}");

    // Assert: focus moved, and Enter selects what is focused.
    const right = screen.getByTestId("project-map-node-right");
    expect(right).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(useProjectMapStore.getState().selection).toEqual(["right"]);
    expect(right).toHaveAttribute("aria-pressed", "true");
  });

  it("adds to the selection with shift, and clears it with Escape", async () => {
    // Arrange
    const user = userEvent.setup();
    renderCanvas();
    await user.tab();
    await user.keyboard("{Enter}");

    // Act
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Shift>}{Enter}{/Shift}");

    // Assert
    expect(useProjectMapStore.getState().selection).toEqual(["left", "below"]);

    // Act
    await user.keyboard("{Escape}");

    // Assert
    expect(useProjectMapStore.getState().selection).toEqual([]);
  });

  it("fades everything outside the selection's neighbourhood", async () => {
    // Arrange
    const user = userEvent.setup();
    renderCanvas();

    // Act: select a node wired to `right` but not to `below`.
    await user.tab();
    await user.keyboard("{Enter}");

    // Assert: the neighbour stays lit, the unrelated node is faded out.
    expect(screen.getByTestId("project-map-node-right")).toHaveAttribute(
      "opacity",
      "1",
    );
    expect(
      Number(screen.getByTestId("project-map-node-below").getAttribute("opacity")),
    ).toBeLessThan(1);
  });

  it("folds a collapsed group into one plate that keeps the edges crossing it", async () => {
    // Arrange
    const user = userEvent.setup();
    renderCanvas();

    // Act
    await user.click(screen.getByTestId("project-map-group-toggle-web"));

    // Assert: the members are gone, the group remains, and the edge that left
    // the group now arrives at the group itself.
    expect(screen.queryByTestId("project-map-node-left")).toBeNull();
    expect(screen.getByTestId("project-map-group-web")).toBeInTheDocument();
    const document__ = useProjectMapStore.getState().document;
    expect(document__?.groups[0].collapsed).toBe(true);
    expect(projectMapGroupNodeId("web")).toBe("group:web");
  });

  it("gives every plate a stable DOM id so keyboard focus can be moved to it", () => {
    // Arrange / Act
    renderCanvas();

    // Assert
    expect(screen.getByTestId("project-map-node-left")).toHaveAttribute(
      "id",
      projectMapNodeDomId("left"),
    );
  });
});
