import { describe, expect, it } from "vitest";
import {
  projectMapArrowTarget,
  projectMapFocusIds,
  projectMapGroupNodeId,
  projectMapNeighbors,
  projectMapRenderModel,
} from "#/utils/project-map/project-map-graph";
import {
  PROJECT_MAP_VERSION,
  type PlacedProjectMapDocument,
  type PlacedProjectMapNode,
} from "#/types/project-map";
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
    size: 100,
    x: 0,
    y: 0,
    pinned: false,
    hidden: false,
    tags: [],
    ...overrides,
  };
}

function document(
  overrides: Partial<PlacedProjectMapDocument> = {},
): PlacedProjectMapDocument {
  return {
    version: PROJECT_MAP_VERSION,
    generated_at: null,
    commit: null,
    groups: [],
    nodes: [],
    edges: [],
    notes: [],
  canvas: defaultProjectMapCanvas(),
    ...overrides,
  };
}

describe("projectMapNeighbors", () => {
  it("splits the edges touching a node by direction, for walking the graph", () => {
    // Arrange
    const edges = [
      { from: "a", to: "b", kind: "calls" as const, label: null },
      { from: "c", to: "b", kind: "imports" as const, label: null },
    ];

    // Act
    const neighbors = projectMapNeighbors(edges, "b");

    // Assert
    expect(neighbors.inbound.map((edge) => edge.from)).toEqual(["a", "c"]);
    expect(neighbors.outbound).toEqual([]);
  });
});

describe("projectMapFocusIds", () => {
  it("keeps the selection and its direct neighbours lit, and nothing further", () => {
    // Arrange
    const edges = [
      { from: "a", to: "b", kind: "calls" as const, label: null },
      { from: "b", to: "c", kind: "calls" as const, label: null },
    ];

    // Act
    const focus = projectMapFocusIds(["a"], edges);

    // Assert
    expect([...focus].sort()).toEqual(["a", "b"]);
  });

  it("fades nothing when nothing is selected", () => {
    // Act / Assert
    expect(projectMapFocusIds([], [])).toEqual(new Set());
  });
});

describe("projectMapRenderModel", () => {
  it("removes a hidden node and the edges that hung off it", () => {
    // Arrange
    const source = document({
      nodes: [node({ id: "a" }), node({ id: "noise", hidden: true })],
      edges: [{ from: "a", to: "noise", kind: "imports", label: null }],
    });

    // Act
    const model = projectMapRenderModel(source);

    // Assert
    expect(model.nodes.map((entry) => entry.id)).toEqual(["a"]);
    expect(model.edges).toEqual([]);
  });

  it("folds a collapsed group into one plate and redirects the edges that crossed it", () => {
    // Arrange
    const source = document({
      groups: [{ id: "web", label: "Web app", accent: "1", collapsed: true }],
      nodes: [
        node({ id: "outside" }),
        node({ id: "inside-1", group: "web" }),
        node({ id: "inside-2", group: "web" }),
      ],
      edges: [
        { from: "outside", to: "inside-1", kind: "calls", label: null },
        // A second crossing of the same kind must not draw a duplicate line.
        { from: "outside", to: "inside-2", kind: "calls", label: null },
        // An edge wholly inside the group disappears with it.
        { from: "inside-1", to: "inside-2", kind: "imports", label: null },
      ],
    });

    // Act
    const model = projectMapRenderModel(source);

    // Assert
    expect(model.nodes.map((entry) => entry.id)).toEqual(["outside"]);
    expect(model.collapsedGroupIds).toEqual(["web"]);
    expect(model.edges).toHaveLength(1);
    expect(model.edges[0]).toMatchObject({
      from: "outside",
      to: projectMapGroupNodeId("web"),
      kind: "calls",
    });
  });

  it("keys an edge with something a DOM attribute can hold", () => {
    // Arrange
    const source = document({
      nodes: [node({ id: "a" }), node({ id: "b" })],
      edges: [
        { from: "a", to: "b", kind: "calls", label: null },
        { from: "a", to: "b", kind: "reads", label: null },
      ],
    });

    // Act: the key is also the edge's `data-testid`.
    const keys = projectMapRenderModel(source).edges.map((edge) => edge.key);

    // Assert: distinct relationships keep distinct keys, and a key a selector
    // cannot be written for is a key the drawing cannot be addressed by.
    expect(new Set(keys).size).toBe(2);
    for (const key of keys) {
      // eslint-disable-next-line no-control-regex
      expect(key).not.toMatch(/[\u0000-\u001f]/);
      expect(key).toContain("a");
      expect(key).toContain("b");
    }
  });
});

describe("projectMapArrowTarget", () => {
  it("prefers a node straight ahead over a nearer one off to the side", () => {
    // Arrange
    const nodes = [
      node({ id: "origin", x: 0, y: 0 }),
      node({ id: "ahead", x: 400, y: 0 }),
      node({ id: "off-axis", x: 200, y: 400 }),
    ];

    // Act / Assert
    expect(projectMapArrowTarget(nodes, "origin", "right")).toBe("ahead");
    expect(projectMapArrowTarget(nodes, "origin", "down")).toBe("off-axis");
  });

  it("stays put at the edge of the drawing rather than wrapping around", () => {
    // Arrange
    const nodes = [
      node({ id: "origin", x: 0, y: 0 }),
      node({ id: "right", x: 400, y: 0 }),
    ];

    // Act / Assert
    expect(projectMapArrowTarget(nodes, "origin", "left")).toBeNull();
  });
});
