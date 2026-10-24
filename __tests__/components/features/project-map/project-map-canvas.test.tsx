import React from "react";
import { act, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { defaultProjectMapCanvas } from "#/utils/project-map/project-map-authoring";

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
  canvas: defaultProjectMapCanvas(),
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

/**
 * The frame the pointer coordinates are measured against. jsdom has no layout,
 * so a drag has no meaning without one.
 */
function stubFrame() {
  vi.spyOn(SVGElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    width: 900,
    height: 600,
    right: 900,
    bottom: 600,
    toJSON: () => ({}),
  } as DOMRect);
}

const POINTER = { pointerId: 1, button: 0 };

/** A press and a release at the same place: a click, however it is delivered. */
function tap(element: Element, at = { clientX: 40, clientY: 40 }, init = {}) {
  fireEvent.pointerDown(element, { ...POINTER, ...at, ...init });
  fireEvent.pointerUp(element, { ...POINTER, ...at, ...init });
}

describe("ProjectMapCanvas", () => {
  beforeEach(() => {
    useProjectMapStore.getState().reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
      Number(
        screen.getByTestId("project-map-node-below").getAttribute("opacity"),
      ),
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

  it("moves the paper exactly as far as the pointer, over a drag of many moves", () => {
    // Arrange: a half-scale view, so a correct pan also divides by the scale.
    stubFrame();
    renderCanvas();
    act(() => {
      useProjectMapStore.getState().setViewport({ x: 0, y: 0, scale: 0.5 });
    });
    const canvas = screen.getByTestId("project-map-canvas");

    // Act: one press and two moves, 100 screen pixels to the right in total.
    fireEvent.pointerDown(canvas, {
      ...POINTER,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(canvas, { ...POINTER, clientX: 150, clientY: 100 });
    fireEvent.pointerMove(canvas, { ...POINTER, clientX: 200, clientY: 100 });
    fireEvent.pointerUp(canvas, { ...POINTER, clientX: 200, clientY: 100 });

    // Assert: the paper followed the whole 100 pixels — 200 diagram units at
    // this scale. Measuring each move against the viewport the previous move
    // already shifted would land on half of that.
    expect(useProjectMapStore.getState().viewport).toMatchObject({
      x: -200,
      y: 0,
      scale: 0.5,
    });
  });

  it("narrows a multi-selection on click, and clears it on empty paper", () => {
    // Arrange: two plates selected, the second one added with shift.
    stubFrame();
    renderCanvas();
    tap(screen.getByTestId("project-map-node-left"));
    tap(screen.getByTestId("project-map-node-right"), undefined, {
      shiftKey: true,
    });
    expect(useProjectMapStore.getState().selection).toEqual(["left", "right"]);

    // Act: a plain click on a plate already in the selection.
    tap(screen.getByTestId("project-map-node-right"));

    // Assert: the selection narrows to it. The pointer is captured by the
    // canvas during a press, so the plate's own click never arrives.
    expect(useProjectMapStore.getState().selection).toEqual(["right"]);

    // Act: a click on the paper.
    tap(screen.getByTestId("project-map-canvas"));

    // Assert
    expect(useProjectMapStore.getState().selection).toEqual([]);
  });

  it("keeps a plate selected when the press turns into a drag", () => {
    // Arrange
    stubFrame();
    renderCanvas();
    const plate = screen.getByTestId("project-map-node-left");

    // Act: press, travel, release — a move, not a click.
    fireEvent.pointerDown(plate, { ...POINTER, clientX: 40, clientY: 40 });
    fireEvent.pointerMove(screen.getByTestId("project-map-canvas"), {
      ...POINTER,
      clientX: 140,
      clientY: 40,
    });
    fireEvent.pointerUp(screen.getByTestId("project-map-canvas"), {
      ...POINTER,
      clientX: 140,
      clientY: 40,
    });

    // Assert: the plate moved and is still the selection, and the document is
    // the thing that changed.
    const open = useProjectMapStore.getState();
    expect(open.selection).toEqual(["left"]);
    expect(open.dirty).toBe(true);
    expect(open.document?.nodes.find((entry) => entry.id === "left")?.x).toBe(
      100,
    );
  });

  it("takes focus on a mouse press so Escape clears the selection", async () => {
    // Arrange
    stubFrame();
    const user = userEvent.setup();
    renderCanvas();
    tap(screen.getByTestId("project-map-node-left"));
    const canvas = screen.getByTestId("project-map-canvas");

    // Act: press the paper with a shift held, sweeping nothing, so the
    // selection survives to be cleared by the keyboard.
    fireEvent.pointerDown(canvas, {
      ...POINTER,
      clientX: 10,
      clientY: 10,
      shiftKey: true,
    });

    // Assert: focus is somewhere the canvas can hear a key, not on the body.
    expect(canvas).toHaveFocus();

    // Act
    fireEvent.pointerUp(canvas, {
      ...POINTER,
      clientX: 10,
      clientY: 10,
      shiftKey: true,
    });
    useProjectMapStore.getState().setSelection(["left"]);
    await user.keyboard("{Escape}");

    // Assert
    expect(useProjectMapStore.getState().selection).toEqual([]);
  });

  it("writes a note on the drawing and throws it away again", async () => {
    // Arrange: a note added the way the inspector adds one.
    stubFrame();
    const user = userEvent.setup();
    renderCanvas();
    act(() => {
      useProjectMapStore.getState().addNote({
        id: "note-1",
        text: "",
        anchor: "left",
        x: 40,
        y: -56,
      });
    });

    // Assert: a new note opens its own editor, so it is not a dead end.
    const field = screen.getByRole("textbox");

    // Act
    await user.type(field, "read this first");
    fireEvent.blur(field);

    // Assert
    expect(useProjectMapStore.getState().document?.notes[0]).toMatchObject({
      id: "note-1",
      text: "read this first",
    });
    expect(screen.getByTestId("project-map-note-note-1")).toHaveTextContent(
      "read this first",
    );

    // Act
    await user.click(screen.getByTestId("project-map-remove-note-note-1"));

    // Assert
    expect(useProjectMapStore.getState().document?.notes).toEqual([]);
    expect(screen.queryByTestId("project-map-note-note-1")).toBeNull();
  });

  it("reopens an existing note for editing when it is clicked", async () => {
    // Arrange
    stubFrame();
    const user = userEvent.setup();
    renderCanvas();
    act(() => {
      useProjectMapStore
        .getState()
        .addNote({ id: "note-2", text: "old", anchor: null, x: 0, y: 0 });
      useProjectMapStore.getState().setEditingNote(null);
    });
    expect(screen.queryByRole("textbox")).toBeNull();

    // Act
    await user.click(screen.getByTestId("project-map-edit-note-note-2"));
    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "new");
    fireEvent.blur(screen.getByRole("textbox"));

    // Assert
    expect(useProjectMapStore.getState().document?.notes[0].text).toBe("new");
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
