import { describe, expect, it } from "vitest";
import { mergeProjectMap } from "#/utils/project-map/merge-project-map";
import {
  PROJECT_MAP_VERSION,
  type ProjectMapDocument,
  type ProjectMapNode,
  type ProjectMapShape,
} from "#/types/project-map";
import { projectMapNodeSize } from "#/utils/project-map/project-map-layout";

function node(
  overrides: Partial<ProjectMapNode> & { id: string },
): ProjectMapNode {
  return {
    kind: "module",
    label: overrides.id,
    path: overrides.id,
    group: null,
    summary: "",
    size: 100,
    x: null,
    y: null,
    pinned: false,
    hidden: false,
    tags: [],
    ...overrides,
  };
}

function document(
  overrides: Partial<ProjectMapDocument> = {},
): ProjectMapDocument {
  return {
    version: PROJECT_MAP_VERSION,
    generated_at: null,
    commit: null,
    groups: [],
    nodes: [],
    edges: [],
    notes: [],
    ...overrides,
  };
}

function shape(
  overrides: Partial<ProjectMapShape> & { id: string },
): ProjectMapShape {
  return {
    kind: "box",
    text: "",
    x: 0,
    y: 0,
    width: 180,
    height: 64,
    accent: null,
    parent: null,
    anchor: null,
    pinned: false,
    collapsed: false,
    tags: [],
    ...overrides,
  };
}

describe("mergeProjectMap", () => {
  it("keeps the arrangement of a node the new analysis still reports", () => {
    // Arrange
    const previous = document({
      groups: [{ id: "web", label: "Web app", accent: "2", collapsed: true }],
      nodes: [
        node({
          id: "src/a.ts",
          x: 300,
          y: 180,
          pinned: true,
          hidden: true,
          group: "web",
        }),
      ],
      notes: [
        { id: "n1", text: "the hot path", anchor: "src/a.ts", x: 10, y: 20 },
      ],
    });
    const incoming = document({
      commit: "feed1234",
      nodes: [
        node({
          id: "src/a.ts",
          x: 0,
          y: 0,
          summary: "Now does more.",
          size: 480,
        }),
      ],
    });

    // Act
    const { document: merged } = mergeProjectMap(previous, incoming);

    // Assert: the person's decisions survive, the analysis's facts win.
    expect(merged.nodes[0]).toMatchObject({
      x: 300,
      y: 180,
      pinned: true,
      hidden: true,
      group: "web",
      summary: "Now does more.",
      size: 480,
    });
    expect(merged.commit).toBe("feed1234");
    expect(merged.groups).toEqual(previous.groups);
    expect(merged.notes).toEqual(previous.notes);
  });

  it("keeps a label the user typed and takes one the last analysis guessed", () => {
    // Arrange
    const previous = document({
      nodes: [
        node({
          id: "src/renamed.ts",
          label: "The gateway",
          label_source: "user",
          x: 0,
          y: 0,
        }),
        node({ id: "src/auto.ts", label: "auto", x: 0, y: 100 }),
      ],
    });
    const incoming = document({
      nodes: [
        node({ id: "src/renamed.ts", label: "renamed" }),
        node({ id: "src/auto.ts", label: "a better guess" }),
      ],
    });

    // Act
    const { document: merged } = mergeProjectMap(previous, incoming);

    // Assert
    expect(merged.nodes[0]).toMatchObject({
      label: "The gateway",
      label_source: "user",
    });
    expect(merged.nodes[1].label).toBe("a better guess");
  });

  it("places a genuinely new node clear of the drawing instead of on top of it", () => {
    // Arrange
    const existing = node({ id: "src/a.ts", x: 400, y: 200, size: 100 });
    const previous = document({ nodes: [existing] });
    const incoming = document({
      nodes: [
        node({ id: "src/a.ts" }),
        node({ id: "src/new.ts", x: 400, y: 200 }),
      ],
    });

    // Act
    const { document: merged, addedNodeIds } = mergeProjectMap(
      previous,
      incoming,
    );

    // Assert
    expect(addedNodeIds).toEqual(["src/new.ts"]);
    const placed = merged.nodes.find(
      (candidate) => candidate.id === "src/new.ts",
    );
    expect(placed?.x).toBeGreaterThan(
      existing.x! + projectMapNodeSize(existing.size).width,
    );
  });

  it("drops a node the analysis no longer reports, and the edges and notes that hung off it", () => {
    // Arrange
    const previous = document({
      nodes: [
        node({ id: "src/a.ts", x: 0, y: 0 }),
        node({ id: "src/deleted.ts", x: 0, y: 100, pinned: true }),
      ],
      notes: [
        {
          id: "n1",
          text: "about the deleted one",
          anchor: "src/deleted.ts",
          x: 5,
          y: 5,
        },
      ],
    });
    const incoming = document({ nodes: [node({ id: "src/a.ts" })] });

    // Act
    const { document: merged, removedNodeIds } = mergeProjectMap(
      previous,
      incoming,
    );

    // Assert: the remark survives, unanchored, rather than disappearing with it.
    expect(removedNodeIds).toEqual(["src/deleted.ts"]);
    expect(merged.nodes.map((candidate) => candidate.id)).toEqual(["src/a.ts"]);
    expect(merged.notes).toEqual([
      { id: "n1", text: "about the deleted one", anchor: null, x: 5, y: 5 },
    ]);
  });

  it("keeps a group the analysis never mentions, because nodes were moved into it by hand", () => {
    // Arrange
    const previous = document({
      groups: [
        { id: "mine", label: "Rendering layer", accent: "4", collapsed: false },
      ],
      nodes: [node({ id: "src/a.ts", group: "mine", x: 0, y: 0 })],
    });
    const incoming = document({
      groups: [
        { id: "generated", label: "Generated", accent: "1", collapsed: false },
      ],
      nodes: [node({ id: "src/a.ts", group: "generated" })],
    });

    // Act
    const { document: merged } = mergeProjectMap(previous, incoming);

    // Assert
    expect(merged.groups.map((group) => group.id)).toEqual([
      "mine",
      "generated",
    ]);
    expect(merged.nodes[0].group).toBe("mine");
  });

  it("takes the new analysis's edges wholesale, because relationships are its job", () => {
    // Arrange
    const previous = document({
      nodes: [
        node({ id: "src/a.ts", x: 0, y: 0 }),
        node({ id: "src/b.ts", x: 0, y: 100 }),
      ],
      edges: [
        { from: "src/a.ts", to: "src/b.ts", kind: "imports", label: null },
      ],
    });
    const incoming = document({
      nodes: [node({ id: "src/a.ts" }), node({ id: "src/b.ts" })],
      edges: [{ from: "src/b.ts", to: "src/a.ts", kind: "calls", label: null }],
    });

    // Act
    const { document: merged } = mergeProjectMap(previous, incoming);

    // Assert
    expect(merged.edges).toEqual(incoming.edges);
  });

  it("leaves the drawn layer alone when the analysis runs again", () => {
    // Arrange: a map with a drawing on it, re-analysed.
    const drawn = {
      view: { mode: "both" as const, layout: "tree" as const },
      shapes: [shape({ id: "shape-1", text: "Retry policy", x: 320, y: -180 })],
      connectors: [
        {
          id: "conn-1",
          from: { attach: "shape" as const, shape: "shape-1", side: null },
          to: { attach: "free" as const, x: 10, y: 10 },
          waypoints: [],
          dash: "solid" as const,
          head: "filled" as const,
          label: null,
          accent: null,
        },
      ],
    };
    const previous = document({ nodes: [node({ id: "a" })], canvas: drawn });
    const incoming = document({ nodes: [node({ id: "a" }), node({ id: "b" })] });

    // Act
    const result = mergeProjectMap(previous, incoming);

    // Assert: the analysis owns the nodes, the person owns the drawing.
    expect(result.document.canvas).toEqual(drawn);
    expect(result.addedNodeIds).toEqual(["b"]);
  });

  it("releases a shape anchored to a node the analysis dropped, and keeps the shape", () => {
    // Arrange
    const previous = document({
      nodes: [node({ id: "gone" })],
      canvas: {
        view: { mode: "both", layout: "free" },
        shapes: [
          shape({
            id: "shape-1",
            x: 400,
            y: 120,
            anchor: { layer: "code", node: "gone", dx: 20, dy: 20 },
          }),
          shape({
            id: "shape-2",
            anchor: { layer: "work", node: "cycle:abc", dx: 0, dy: 0 },
          }),
        ],
        connectors: [],
      },
    });
    const incoming = document({ nodes: [node({ id: "kept" })] });

    // Act
    const result = mergeProjectMap(previous, incoming);

    // Assert: released in place and reported, never deleted — and a reference
    // into the live work layer is not "repaired", because it always looks
    // missing from a committed file.
    const shapes = result.document.canvas.shapes;
    expect(shapes).toHaveLength(2);
    expect(shapes[0].anchor).toBeNull();
    expect(shapes[0].x).toBe(400);
    expect(shapes[1].anchor).toEqual({
      layer: "work",
      node: "cycle:abc",
      dx: 0,
      dy: 0,
    });
    expect(result.releasedShapeIds).toEqual(["shape-1"]);
  });

  it("accepts a drawing from the analysis only when the user has drawn nothing", () => {
    // Arrange: the agent was asked to sketch something.
    const sketched = {
      view: { mode: "freeform" as const, layout: "tree" as const },
      shapes: [shape({ id: "shape-9", text: "proposed split" })],
      connectors: [],
    };
    const blank = document({ nodes: [node({ id: "a" })] });
    const drawnOn = document({
      nodes: [node({ id: "a" })],
      canvas: {
        view: { mode: "both", layout: "free" },
        shapes: [shape({ id: "shape-1", text: "mine" })],
        connectors: [],
      },
    });
    const incoming = document({ nodes: [node({ id: "a" })], canvas: sketched });

    // Act
    const ontoBlank = mergeProjectMap(blank, incoming);
    const ontoDrawn = mergeProjectMap(drawnOn, incoming);

    // Assert
    expect(ontoBlank.document.canvas.shapes[0].text).toBe("proposed split");
    expect(ontoDrawn.document.canvas.shapes[0].text).toBe("mine");
  });
});
