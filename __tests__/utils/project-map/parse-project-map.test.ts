import { describe, expect, it } from "vitest";
import {
  parseProjectMap,
  serializeProjectMap,
} from "#/utils/project-map/parse-project-map";
import { PROJECT_MAP_VERSION } from "#/types/project-map";

/** The smallest document the page should accept. */
function minimalDocument() {
  return {
    version: PROJECT_MAP_VERSION,
    nodes: [
      {
        id: "src/routes/home.tsx",
        kind: "route",
        label: "home",
        path: "src/routes/home.tsx",
        group: "web",
        summary: "Landing page and launcher.",
        size: 420,
        x: 120,
        y: 40,
        pinned: true,
        tags: ["entry"],
      },
    ],
    groups: [{ id: "web", label: "Web app", accent: "1", collapsed: false }],
    edges: [],
    notes: [],
  };
}

describe("parseProjectMap", () => {
  it("reads a document and fills in the fields the writer may omit", () => {
    // Arrange
    const raw = JSON.stringify({
      version: PROJECT_MAP_VERSION,
      generated_at: "2026-10-22T04:00:00Z",
      commit: "abc1234",
      nodes: [{ id: "src/a.ts", kind: "module", label: "a" }],
    });

    // Act
    const result = parseProjectMap(raw);

    // Assert
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.commit).toBe("abc1234");
    expect(result.document.nodes[0]).toMatchObject({
      id: "src/a.ts",
      kind: "module",
      label: "a",
      path: null,
      group: null,
      summary: "",
      size: 0,
      x: null,
      y: null,
      pinned: false,
      hidden: false,
      tags: [],
    });
    expect(result.document.groups).toEqual([]);
    expect(result.document.edges).toEqual([]);
    expect(result.document.notes).toEqual([]);
  });

  it("rejects text that is not JSON", () => {
    // Arrange / Act
    const result = parseProjectMap("{ not json");

    // Assert
    expect(result).toMatchObject({ ok: false, reason: "not-json" });
  });

  it("rejects a document written by a newer version and reports it", () => {
    // Arrange
    const raw = JSON.stringify({ ...minimalDocument(), version: 99 });

    // Act
    const result = parseProjectMap(raw);

    // Assert
    expect(result).toMatchObject({
      ok: false,
      reason: "unsupported-version",
      foundVersion: 99,
    });
  });

  it("points at the offending value when a node is malformed", () => {
    // Arrange: a node kind no silhouette exists for.
    const document = minimalDocument();
    document.nodes.push({
      ...document.nodes[0],
      id: "src/b.ts",
      kind: "spaceship",
    });
    const raw = JSON.stringify(document);

    // Act
    const result = parseProjectMap(raw);

    // Assert
    expect(result).toMatchObject({
      ok: false,
      reason: "invalid-field",
      pointer: "nodes[1].kind",
    });
  });

  it("rejects a node without an id, because identity is what makes the map editable", () => {
    // Arrange
    const document = minimalDocument();
    const [node] = document.nodes;
    const raw = JSON.stringify({
      ...document,
      nodes: [{ ...node, id: "" }],
    });

    // Act
    const result = parseProjectMap(raw);

    // Assert
    expect(result).toMatchObject({
      ok: false,
      reason: "invalid-field",
      pointer: "nodes[0].id",
    });
  });

  it("drops an edge to a node that is not in the document and says so", () => {
    // Arrange
    const raw = JSON.stringify({
      ...minimalDocument(),
      edges: [
        { from: "src/routes/home.tsx", to: "src/gone.ts", kind: "imports" },
      ],
    });

    // Act
    const result = parseProjectMap(raw);

    // Assert
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.edges).toEqual([]);
    expect(result.warnings).toEqual([{ kind: "dangling-edge", count: 1 }]);
  });

  it("keeps the first of two nodes sharing an id so identity stays unique", () => {
    // Arrange
    const document = minimalDocument();
    const raw = JSON.stringify({
      ...document,
      nodes: [
        document.nodes[0],
        { ...document.nodes[0], label: "duplicate", x: 999 },
      ],
    });

    // Act
    const result = parseProjectMap(raw);

    // Assert
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.nodes).toHaveLength(1);
    expect(result.document.nodes[0].label).toBe("home");
    expect(result.warnings).toEqual([{ kind: "duplicate-node", count: 1 }]);
  });

  it("clears a group reference no group declares, so nothing renders into a void", () => {
    // Arrange
    const document = minimalDocument();
    const raw = JSON.stringify({ ...document, groups: [] });

    // Act
    const result = parseProjectMap(raw);

    // Assert
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.nodes[0].group).toBeNull();
    expect(result.warnings).toEqual([{ kind: "unknown-group", count: 1 }]);
  });

  it("unanchors a note whose node is gone rather than losing the remark", () => {
    // Arrange
    const raw = JSON.stringify({
      ...minimalDocument(),
      notes: [{ id: "n1", text: "the hot path", anchor: "src/gone.ts", x: 3, y: 4 }],
    });

    // Act
    const result = parseProjectMap(raw);

    // Assert
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.notes).toEqual([
      { id: "n1", text: "the hot path", anchor: null, x: 3, y: 4 },
    ]);
    expect(result.warnings).toEqual([{ kind: "orphan-note", count: 1 }]);
  });

  it("round-trips through serialization so the agent and the page read one file", () => {
    // Arrange
    const first = parseProjectMap(JSON.stringify(minimalDocument()));
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Act
    const second = parseProjectMap(serializeProjectMap(first.document));

    // Assert
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.document).toEqual(first.document);
  });
});
