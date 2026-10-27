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
import { projectMapGroupBounds } from "#/utils/project-map/project-map-layout";
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
function Harness({
  waitingParts,
}: {
  waitingParts?: ReadonlyMap<string, string>;
}) {
  const frameRef = React.useRef<SVGSVGElement | null>(null);
  const open = useProjectMapStore((state) => state.document);
  if (open === null) return null;
  return (
    <ProjectMapCanvas
      document={open}
      frameRef={frameRef}
      waitingParts={waitingParts}
    />
  );
}

function renderCanvas(waitingParts?: ReadonlyMap<string, string>) {
  useProjectMapStore.getState().hydrate("test-revision", document_);
  return renderWithProviders(<Harness waitingParts={waitingParts} />);
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

  it("draws the layers as blocks in the overview, and opens one close enough to read", () => {
    // Arrange: two layers with parts and a relation between them, shown as
    // the overview. The frame is a laptop's worth of paper.
    stubFrame();
    useProjectMapStore.getState().hydrate("test-revision", {
      ...document_,
      groups: [
        { id: "web", label: "Web app", accent: "1", collapsed: true },
        { id: "data", label: "Data", accent: "2", collapsed: false },
      ],
      nodes: [
        node({ id: "left", x: 0, y: 0, group: "web" }),
        node({ id: "right", x: 400, y: 0, group: "web" }),
        node({ id: "table", x: 0, y: 2000, group: "data" }),
      ],
      edges: [
        { from: "left", to: "table", kind: "reads", label: null },
        { from: "right", to: "table", kind: "writes", label: null },
      ],
    });
    useProjectMapStore.getState().setOverview(true);
    renderWithProviders(<Harness />);

    // Assert: blocks, not plates; the relations folded into one counted line.
    expect(screen.getByTestId("project-map-overview")).toBeInTheDocument();
    expect(screen.queryByTestId(projectMapNodeDomId("left"))).toBeNull();
    expect(
      screen.getByTestId("project-map-overview-block-web"),
    ).toHaveTextContent("Web app");
    expect(
      screen.getByTestId("project-map-overview-link-web>data"),
    ).toHaveTextContent("2");

    // Act: open the web layer.
    // The block says where its parts live, under the layer's name.
    expect(
      screen.getByTestId("project-map-overview-block-web"),
    ).toHaveAttribute("data-where");
    fireEvent.click(screen.getByTestId("project-map-overview-block-web"));

    // Assert: the detail is back, the layer is unfolded, and the viewport
    // sits on it at a legible scale rather than fitting the whole wall.
    const state = useProjectMapStore.getState();
    expect(state.overview).toBe(false);
    expect(state.document?.groups.find((g) => g.id === "web")?.collapsed).toBe(
      false,
    );
    expect(state.viewport.scale).toBeGreaterThanOrEqual(0.8);
    expect(state.viewport.y).toBeLessThan(0);
    expect(screen.getByTestId(projectMapNodeDomId("left"))).toBeInTheDocument();
  });

  it("names a layer in full when its name outruns one line", () => {
    // Arrange: the live work graph draws names this long.
    stubFrame();
    useProjectMapStore.getState().hydrate("test-revision", {
      ...document_,
      groups: [
        {
          id: "web",
          label: "Runs whose sandbox is gone",
          accent: "1",
          collapsed: false,
        },
      ],
      nodes: [node({ id: "left", x: 0, y: 0, group: "web" })],
      edges: [],
    });
    useProjectMapStore.getState().setOverview(true);
    renderWithProviders(<Harness />);

    // Assert: the last word is on the block, where the name used to end at
    // `Runs whose sandbox is …`.
    const block = screen.getByTestId("project-map-overview-block-web");
    expect(block).toHaveTextContent("gone");
    expect(block.textContent).not.toContain("…");
  });

  it("names every folder a layer lives in, even when one line is too short", () => {
    // Arrange: a layer whose parts live in more folders than a block's width
    // can hold on one line.
    stubFrame();
    useProjectMapStore.getState().hydrate("test-revision", {
      ...document_,
      groups: [{ id: "web", label: "Web app", accent: "1", collapsed: false }],
      nodes: [
        node({ id: "left", x: 0, y: 0, group: "web", path: "server/analyzer.js" }),
        node({ id: "right", x: 400, y: 0, group: "web", path: "server/callgraph.js" }),
        node({ id: "below", x: 0, y: 300, group: "web", path: "server/report-registry.js" }),
      ],
      edges: [],
    });
    useProjectMapStore.getState().setOverview(true);
    renderWithProviders(<Harness />);

    // Assert: the last folder is on the block and nothing was cut, where one
    // line left half of them as `callgraph.j…`.
    const block = screen.getByTestId("project-map-overview-block-web");
    expect(block).toHaveTextContent("report-registry.js");
    expect(block.textContent).not.toContain("…");
  });

  it("puts the layer you opened in the middle, and the rest behind it", () => {
    // Arrange: two layers, the opened one narrower than the frame.
    stubFrame();
    useProjectMapStore.getState().hydrate("test-revision", {
      ...document_,
      groups: [
        { id: "web", label: "Web app", accent: "1", collapsed: false },
        { id: "data", label: "Data", accent: "2", collapsed: false },
      ],
      nodes: [
        node({ id: "left", x: 0, y: 0, group: "web" }),
        node({ id: "right", x: 400, y: 0, group: "web" }),
        node({ id: "table", x: 0, y: 2000, group: "data" }),
      ],
      edges: [],
    });
    useProjectMapStore.getState().setOverview(true);
    renderWithProviders(<Harness />);

    // Act
    fireEvent.click(screen.getByTestId("project-map-overview-block-web"));

    // Assert: the frame's middle is the layer's middle, rather than the
    // layer sitting against the left edge with faded neighbours filling the
    // paper beside it.
    const { viewport } = useProjectMapStore.getState();
    const bounds = projectMapGroupBounds(
      useProjectMapStore.getState().document?.nodes ?? [],
      "web",
    );
    expect(viewport.x + 900 / (2 * viewport.scale)).toBeCloseTo(
      (bounds?.x ?? 0) + (bounds?.width ?? 0) / 2,
      0,
    );

    // Assert: and the layer nobody opened is drawn as context, outline and
    // header included.
    expect(screen.getByTestId("project-map-group-data")).not.toHaveAttribute(
      "opacity",
      "1",
    );
  });

  it("only pans on the overview's paper, whatever tool is in hand", () => {
    // Arrange
    stubFrame();
    renderCanvas();
    useProjectMapStore.getState().setOverview(true);
    useProjectMapStore.getState().setTool("box");
    const paper = screen.getByTestId("project-map-canvas");

    // Act: a drag that would have drawn a box.
    fireEvent.pointerDown(paper, { ...POINTER, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(paper, { ...POINTER, clientX: 160, clientY: 130 });
    fireEvent.pointerUp(paper, { ...POINTER, clientX: 160, clientY: 130 });

    // Assert: the paper moved and nothing was drawn.
    const state = useProjectMapStore.getState();
    expect(state.document?.canvas.shapes).toEqual([]);
    expect(state.viewport.x).toBeLessThan(0);
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

  it("draws every plate while the drawing is small enough to afford it", () => {
    // Arrange: the budget is 400 plates; this document has four, one hidden.
    renderCanvas();

    // Assert: nothing is filtered, including a plate the fit leaves off
    // screen — a half-drawn small map would be a regression, and jsdom has
    // no layout to decide what is on screen anyway.
    expect(screen.getByTestId("project-map-node-left")).toBeInTheDocument();
    expect(screen.getByTestId("project-map-node-right")).toBeInTheDocument();
    expect(screen.getByTestId("project-map-node-below")).toBeInTheDocument();
  });

  it("opens the layer you clicked, and fades the rest", () => {
    // Arrange: two layers on the paper, folded to blocks.
    renderCanvas();
    act(() => useProjectMapStore.getState().setOverview(true));

    // Act
    fireEvent.click(screen.getByTestId("project-map-overview-block-web"));

    // Assert: the layer's own parts are the drawing, the rest is context —
    // a click on one block used to land among every neighbour's plates with
    // no way to tell which layer had been opened.
    expect(useProjectMapStore.getState().openedGroup).toBe("web");
    expect(screen.getByTestId("project-map-node-left")).toHaveAttribute(
      "opacity",
      "1",
    );
    expect(screen.getByTestId("project-map-node-below")).not.toHaveAttribute(
      "opacity",
      "1",
    );

    // Act: back to the blocks.
    act(() => useProjectMapStore.getState().setOverview(true));

    // Assert
    expect(useProjectMapStore.getState().openedGroup).toBeNull();
  });

  it("marks the part a change waiting on a person touches, and its layer", () => {
    // Arrange: one part of the "web" layer is named by a parked change.
    renderCanvas(new Map([["left", "cycle-1"]]));

    // Assert: the mark is on the part itself, not only in the rail.
    expect(screen.getByTestId("project-map-node-left")).toHaveAttribute(
      "data-waiting",
      "true",
    );
    expect(screen.getByTestId("project-map-node-right")).not.toHaveAttribute(
      "data-waiting",
    );
    // Drawn last, so the silhouette cannot paint over it: a shape that
    // reaches its own top-right corner hid the mark completely.
    const drawn = Array.from(
      screen.getByTestId("project-map-node-left").children,
    );
    expect(drawn.indexOf(screen.getByTestId("project-map-waiting-mark"))).toBe(
      drawn.length - 1,
    );

    // Act: folded to layers, the layer holding it carries the count.
    act(() => useProjectMapStore.getState().setOverview(true));

    // Assert
    expect(
      screen.getByTestId("project-map-overview-block-web"),
    ).toHaveAttribute("data-waiting", "1");
  });

  it("folds a collapsed group into one plate that keeps the edges crossing it", async () => {
    // Arrange
    const user = userEvent.setup();
    renderCanvas();

    // Act
    const toggle = screen.getByTestId("project-map-group-toggle-web");
    expect(toggle.querySelector("title")).not.toBeNull(); // says what it does
    await user.click(toggle);

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

  it("pans with the middle button and with held space, whatever tool is in hand", () => {
    // "Pan survives as space-held and middle-button in every tool." With a
    // drawing tool in hand a press on paper *creates* a shape, so without
    // these two the paper is unreachable until the user puts the tool down —
    // and the existing pan case uses the Select tool, where a plain press
    // already pans.
    stubFrame();
    renderCanvas();
    act(() => {
      // Scale 1 so the arithmetic below is the pointer's own distance; the
      // default is not 1, which is why the pan case above sets it too.
      useProjectMapStore.getState().setViewport({ x: 0, y: 0, scale: 1 });
      useProjectMapStore.getState().setTool("box");
    });
    const canvas = screen.getByTestId("project-map-canvas");

    // Act: the middle button, with the Box tool held.
    fireEvent.pointerDown(canvas, {
      ...POINTER,
      button: 1,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(canvas, {
      ...POINTER,
      button: 1,
      clientX: 160,
      clientY: 100,
    });
    fireEvent.pointerUp(canvas, {
      ...POINTER,
      button: 1,
      clientX: 160,
      clientY: 100,
    });

    // Assert: the paper moved and no box was drawn.
    expect(useProjectMapStore.getState().viewport.x).toBe(-60);
    expect(
      useProjectMapStore.getState().document?.canvas.shapes ?? [],
    ).toHaveLength(0);

    // Act: held space, same tool, the other direction.
    fireEvent.keyDown(canvas, { key: " " });
    fireEvent.pointerDown(canvas, { ...POINTER, clientX: 160, clientY: 100 });
    fireEvent.pointerMove(canvas, { ...POINTER, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(canvas, { ...POINTER, clientX: 100, clientY: 100 });
    fireEvent.keyUp(canvas, { key: " " });

    // Assert: back where it started, and still nothing drawn.
    expect(useProjectMapStore.getState().viewport.x).toBe(0);
    expect(
      useProjectMapStore.getState().document?.canvas.shapes ?? [],
    ).toHaveLength(0);
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

  it("draws a box with the box tool where a plain drag would have panned", () => {
    // Arrange
    stubFrame();
    renderCanvas();
    act(() => {
      useProjectMapStore.getState().setTool("box");
    });
    const canvas = screen.getByTestId("project-map-canvas");
    const before = useProjectMapStore.getState().viewport;

    // Act: the same gesture that pans under the Select tool.
    fireEvent.pointerDown(canvas, { ...POINTER, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(canvas, { ...POINTER, clientX: 260, clientY: 220 });
    fireEvent.pointerUp(canvas, { ...POINTER, clientX: 260, clientY: 220 });

    // Assert: a box the size of the sweep, and the paper did not move.
    const { document: open, tool } = useProjectMapStore.getState();
    const [shape] = open?.canvas.shapes ?? [];
    expect(shape).toMatchObject({ kind: "box", width: 160, height: 120 });
    expect(useProjectMapStore.getState().viewport).toEqual(before);
    // One shape per press: the tool goes back to Select so the next press
    // does not quietly make another.
    expect(tool).toBe("select");
  });

  it("still pans on a plain drag and sweeps on a shift-drag with the select tool", () => {
    // Arrange
    stubFrame();
    renderCanvas();
    const canvas = screen.getByTestId("project-map-canvas");

    // Act: pan.
    fireEvent.pointerDown(canvas, { ...POINTER, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(canvas, { ...POINTER, clientX: 160, clientY: 100 });
    fireEvent.pointerUp(canvas, { ...POINTER, clientX: 160, clientY: 100 });

    // Assert: the grammar the editor was built on top of is unchanged.
    expect(useProjectMapStore.getState().viewport.x).toBe(-100);
    expect(useProjectMapStore.getState().document?.canvas.shapes).toHaveLength(
      0,
    );

    // Act: shift-drag sweeps a selection instead.
    fireEvent.pointerDown(canvas, {
      ...POINTER,
      clientX: 0,
      clientY: 0,
      shiftKey: true,
    });
    fireEvent.pointerMove(canvas, { ...POINTER, clientX: 800, clientY: 500 });
    fireEvent.pointerUp(canvas, { ...POINTER, clientX: 800, clientY: 500 });

    // Assert
    expect(useProjectMapStore.getState().selection.length).toBeGreaterThan(0);
  });

  it("connects an analysed plate to a drawn shape", () => {
    // Arrange: one drawn box, and the connect tool in hand.
    stubFrame();
    renderCanvas();
    act(() => {
      const store = useProjectMapStore.getState();
      store.addShape({ kind: "box", x: 600, y: 300 });
      store.setTool("connect");
    });
    const canvas = screen.getByTestId("project-map-canvas");
    const shapeId =
      useProjectMapStore.getState().document?.canvas.shapes[0].id ?? "";

    // Act: pull a line from the plate and release it over the box.
    fireEvent.pointerDown(screen.getByTestId("project-map-node-left"), {
      ...POINTER,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(canvas, { ...POINTER, clientX: 700, clientY: 380 });
    fireEvent.pointerUp(canvas, { ...POINTER, clientX: 700, clientY: 380 });

    // Assert: the two layers are joined, which is the point of sharing one
    // canvas.
    const [connector] =
      useProjectMapStore.getState().document?.canvas.connectors ?? [];
    expect(connector.from).toEqual({
      attach: "derived",
      layer: "code",
      node: "left",
      side: null,
    });
    expect(connector.to).toEqual({
      attach: "shape",
      shape: shapeId,
      side: null,
    });
  });

  it("opens a shape's text on double-click, and Escape leaves the text without clearing the selection", async () => {
    // Arrange
    stubFrame();
    renderCanvas();
    act(() => {
      useProjectMapStore.getState().addShape({ kind: "box", x: 100, y: 100 });
    });
    const shapeId =
      useProjectMapStore.getState().document?.canvas.shapes[0].id ?? "";
    act(() => {
      useProjectMapStore.getState().setEditingShape(null);
      useProjectMapStore.getState().setSelection([shapeId]);
    });

    // Act
    fireEvent.doubleClick(screen.getByTestId(`project-map-shape-${shapeId}`));
    const field = await screen.findByTestId(
      `project-map-shape-text-${shapeId}`,
    );
    await userEvent.type(field, "retry policy");
    fireEvent.keyDown(field, { key: "Escape" });

    // Assert: the words were kept, and Escape meant "done typing" rather than
    // "put the selection down".
    const [shape] = useProjectMapStore.getState().document?.canvas.shapes ?? [];
    expect(shape.text).toBe("retry policy");
    expect(useProjectMapStore.getState().selection).toEqual([shapeId]);
  });

  it("sweeps only what the current mode draws", () => {
    // Arrange: freeform mode, where the analysis is not on the paper.
    stubFrame();
    renderCanvas();
    act(() => {
      const store = useProjectMapStore.getState();
      store.addShape({ kind: "box", x: 100, y: 100 });
      store.setMode("freeform");
      store.clearSelection();
    });
    const canvas = screen.getByTestId("project-map-canvas");

    // Act: a sweep across everything.
    fireEvent.pointerDown(canvas, {
      ...POINTER,
      clientX: 0,
      clientY: 0,
      shiftKey: true,
    });
    fireEvent.pointerMove(canvas, { ...POINTER, clientX: 880, clientY: 580 });
    fireEvent.pointerUp(canvas, { ...POINTER, clientX: 880, clientY: 580 });

    // Assert: plates nobody can see cannot be selected.
    const { selection, document: open } = useProjectMapStore.getState();
    expect(selection).toEqual([open?.canvas.shapes[0].id]);
    expect(
      screen.queryByTestId("project-map-node-left"),
    ).not.toBeInTheDocument();
  });

  it("says so rather than drawing a line to nowhere when its subject is hidden", () => {
    // Arrange: a line from an analysed plate to a drawn box, then a mode that
    // takes the analysis off the paper.
    stubFrame();
    renderCanvas();
    act(() => {
      const store = useProjectMapStore.getState();
      store.addShape({ kind: "box", x: 400, y: 400 });
      const shapeId =
        useProjectMapStore.getState().document?.canvas.shapes[0].id ?? "";
      store.addConnector(
        { attach: "derived", layer: "code", node: "left", side: null },
        { attach: "shape", shape: shapeId, side: null },
      );
      store.setMode("freeform");
    });

    // Assert: the line is left out rather than drawn to the origin, where it
    // would be indistinguishable from a line someone drew there, and the
    // canvas says that something is missing.
    expect(
      screen.queryByTestId(/^project-map-connector-/),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("project-map-hidden-connectors"),
    ).toBeInTheDocument();
  });

  it("makes a child with Tab and a sibling with Enter", async () => {
    // Milestone 1's mind-map grammar, and part of its MVP — "create, move,
    // connect, label, group and *branch* on one canvas". Both store actions
    // and both key bindings had no test at all, so branching could have
    // stopped working without anything noticing.
    stubFrame();
    renderCanvas();
    act(() => {
      useProjectMapStore
        .getState()
        .addShape({ kind: "branch", x: 0, y: 0, text: "root" });
    });
    const canvas = screen.getByTestId("project-map-canvas");
    const [root] = useProjectMapStore.getState().document?.canvas.shapes ?? [];

    // Act: Tab on the root.
    act(() => {
      useProjectMapStore.getState().setSelection([root.id]);
    });
    fireEvent.keyDown(canvas, { key: "Tab" });

    // Assert: a child of the root, to its right, selected and open for its
    // label — a branch you have to go and find is a branch nobody names.
    const afterTab =
      useProjectMapStore.getState().document?.canvas.shapes ?? [];
    expect(afterTab).toHaveLength(2);
    const child = afterTab[1];
    expect(child.parent).toBe(root.id);
    expect(child.x).toBeGreaterThan(root.x + root.width);
    expect(useProjectMapStore.getState().editingShape).toBe(child.id);

    // Act: Enter on the child.
    fireEvent.keyDown(canvas, { key: "Enter" });

    // Assert: a sibling — same parent as the child, below it, not a
    // grandchild.
    const afterEnter =
      useProjectMapStore.getState().document?.canvas.shapes ?? [];
    expect(afterEnter).toHaveLength(3);
    const sibling = afterEnter[2];
    expect(sibling.parent).toBe(root.id);
    expect(sibling.y).toBeGreaterThan(child.y);
  });

  it("moves the origin when a west handle is pulled, and will not invert", () => {
    // Resize is the fourth of milestone 1's drag variants and the only one
    // with geometry worth getting wrong: an east handle just changes the
    // width, but a west or north one has to move the origin *and* shrink by
    // the same amount. Neither the action nor that arithmetic had a test.
    stubFrame();
    renderCanvas();
    act(() => {
      useProjectMapStore.getState().setViewport({ x: 0, y: 0, scale: 1 });
      useProjectMapStore
        .getState()
        .addShape({ kind: "box", x: 100, y: 100, width: 200, height: 120 });
    });
    const [box] = useProjectMapStore.getState().document?.canvas.shapes ?? [];
    act(() => {
      useProjectMapStore.getState().setSelection([box.id]);
    });
    const handle = screen.getByTestId(`project-map-shape-handle-${box.id}-w`);
    const canvas = screen.getByTestId("project-map-canvas");

    // Act: pull the west edge 40 to the right.
    fireEvent.pointerDown(handle, { ...POINTER, clientX: 100, clientY: 160 });
    fireEvent.pointerMove(canvas, { ...POINTER, clientX: 140, clientY: 160 });
    fireEvent.pointerUp(canvas, { ...POINTER, clientX: 140, clientY: 160 });

    // Assert: the left edge moved and the box narrowed by the same 40 — the
    // right edge stayed where it was, which is what pulling a west handle
    // means.
    const pulled = useProjectMapStore.getState().document?.canvas.shapes[0];
    expect(pulled).toMatchObject({ x: 140, width: 160 });
    expect((pulled?.x ?? 0) + (pulled?.width ?? 0)).toBe(300);

    // Act: keep pulling, far past the other edge.
    fireEvent.pointerDown(handle, { ...POINTER, clientX: 140, clientY: 160 });
    fireEvent.pointerMove(canvas, { ...POINTER, clientX: 900, clientY: 160 });
    fireEvent.pointerUp(canvas, { ...POINTER, clientX: 900, clientY: 160 });

    // Assert: clamped rather than inverted. A negative width draws nothing
    // and cannot be grabbed again.
    const clamped = useProjectMapStore.getState().document?.canvas.shapes[0];
    expect(clamped?.width).toBeGreaterThan(0);
  });

  it("typing in a label is typing, not a shortcut", async () => {
    // The fields live inside the SVG, so their keys bubble through the shapes
    // and the paper. `fromTextField` is the guard, it is used in three key
    // handlers, and nothing tested it — while its own comment names exactly
    // what goes wrong without it: "space pans while writing, Backspace
    // deletes the selection instead of a character, and Ctrl+Z undoes the
    // drawing rather than the sentence."
    stubFrame();
    const user = userEvent.setup();
    renderCanvas();
    act(() => {
      useProjectMapStore.getState().setViewport({ x: 0, y: 0, scale: 1 });
      useProjectMapStore.getState().addShape({ kind: "box", x: 0, y: 0 });
    });
    const [box] = useProjectMapStore.getState().document?.canvas.shapes ?? [];
    act(() => {
      useProjectMapStore.getState().setEditingShape(box.id);
    });
    const field = screen.getByRole("textbox");

    // Act: a space, a Backspace, and an undo — all of them inside the field.
    await user.type(field, "a b");
    fireEvent.keyDown(field, { key: "Backspace" });
    fireEvent.keyDown(field, { key: "z", ctrlKey: true });

    // Assert: the space did not pan, the Backspace did not delete the shape,
    // and the undo did not take the shape back.
    expect(useProjectMapStore.getState().viewport).toMatchObject({
      x: 0,
      y: 0,
    });
    expect(useProjectMapStore.getState().document?.canvas.shapes).toHaveLength(
      1,
    );
  });

  it("deletes what was drawn and leaves the analysis alone", () => {
    // The handler says why: "an analysed node is a claim the next analysis
    // will make again, so it is hidden rather than deleted." Deleting one
    // would be undone by the next regeneration anyway, and in the meantime
    // the committed document would disagree with the repository.
    //
    // Delete is the destructive key and appeared nowhere in these tests.
    stubFrame();
    renderCanvas();
    act(() => {
      useProjectMapStore.getState().addShape({ kind: "box", x: 0, y: 0 });
    });
    const [drawn] = useProjectMapStore.getState().document?.canvas.shapes ?? [];
    const canvas = screen.getByTestId("project-map-canvas");

    // Act: both selected, one key.
    act(() => {
      useProjectMapStore.getState().setSelection([drawn.id, "left"]);
    });
    fireEvent.keyDown(canvas, { key: "Delete" });

    // Assert
    const after = useProjectMapStore.getState().document;
    expect(after?.canvas.shapes).toHaveLength(0);
    expect(after?.nodes.some((node) => node.id === "left")).toBe(true);
  });

  it("leaves a deleted parent's child and its lines behind", () => {
    // Two invariants in the same path, both about not losing more than was
    // asked for: "a child whose parent is gone becomes a root rather than
    // vanishing", and "a line whose end is gone ends where that end was".
    stubFrame();
    renderCanvas();
    act(() => {
      useProjectMapStore.getState().addShape({ kind: "branch", x: 0, y: 0 });
    });
    const [root] = useProjectMapStore.getState().document?.canvas.shapes ?? [];
    act(() => {
      useProjectMapStore.getState().addBranchChild(root.id);
    });
    const shapes = useProjectMapStore.getState().document?.canvas.shapes ?? [];
    const [parent, child] = shapes;
    act(() => {
      useProjectMapStore
        .getState()
        .addConnector(
          { attach: "shape", shape: parent.id, side: null },
          { attach: "shape", shape: child.id, side: null },
        );
      useProjectMapStore.getState().setSelection([parent.id]);
    });
    const canvas = screen.getByTestId("project-map-canvas");

    // Act
    fireEvent.keyDown(canvas, { key: "Delete" });

    // Assert: the child survives as a root, and the line survives with its
    // loose end where the parent was rather than disappearing with it.
    const after = useProjectMapStore.getState().document?.canvas;
    expect(after?.shapes.map((shape) => shape.id)).toEqual([child.id]);
    expect(after?.shapes[0].parent).toBeNull();
    expect(after?.connectors).toHaveLength(1);
    expect(after?.connectors[0].from.attach).toBe("free");
  });
});
