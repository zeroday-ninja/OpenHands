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

/**
 * A document with something drawn on it.
 *
 * Typed loosely on purpose: this is raw input to a parser whose whole job is
 * to not trust it, so a fixture that could only express valid documents would
 * be unable to state most of these cases.
 */
interface RawDrawn {
  canvas: {
    view: { mode: string; layout: string };
    shapes: {
      id: string;
      kind: string;
      text: string;
      x: number;
      y: number;
      width: number;
      height: number;
      accent: string | null;
      parent: string | null;
      anchor: Record<string, unknown> | null;
      pinned: boolean;
      collapsed: boolean;
      tags: string[];
    }[];
    connectors: {
      id: string;
      from: Record<string, unknown>;
      to: Record<string, unknown>;
      waypoints: { x: number; y: number }[];
      dash: string;
      head: string;
      label: string | null;
      accent: string | null;
    }[];
  };
  [key: string]: unknown;
}

function drawnDocument(): RawDrawn {
  return {
    ...minimalDocument(),
    canvas: {
      view: { mode: "both", layout: "tree" },
      shapes: [
        {
          id: "shape-1",
          kind: "box",
          text: "Retry policy",
          x: 320,
          y: -180,
          width: 180,
          height: 64,
          accent: "3",
          parent: null,
          anchor: {
            layer: "code",
            node: "src/routes/home.tsx",
            dx: 40,
            dy: -120,
          },
          pinned: false,
          collapsed: false,
          tags: [],
        },
      ],
      connectors: [
        {
          id: "conn-1",
          from: { attach: "shape", shape: "shape-1", side: "bottom" },
          to: {
            attach: "derived",
            layer: "code",
            node: "src/routes/home.tsx",
            side: "top",
          },
          waypoints: [{ x: 410, y: -40 }],
          dash: "dashed",
          head: "filled",
          label: "replay",
          accent: null,
        },
      ],
    },
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
      notes: [
        { id: "n1", text: "the hot path", anchor: "src/gone.ts", x: 3, y: 4 },
      ],
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

  it("keeps a drawn shape whose anchor names a node the analysis dropped", () => {
    // Arrange: the shape points at a node that is not in the document.
    const raw = drawnDocument();
    raw.canvas.shapes[0].anchor = {
      layer: "code",
      node: "src/routes/gone.tsx",
      dx: 40,
      dy: -120,
    };
    raw.canvas.connectors[0].to = {
      attach: "derived",
      layer: "code",
      node: "src/routes/gone.tsx",
      side: "top",
    };

    // Act
    const result = parseProjectMap(JSON.stringify(raw));

    // Assert: the drawing survives, released in place, and the repair is
    // counted. Losing hand-drawn work to a stale reference is the one thing
    // this layer must never do.
    if (!result.ok) throw new Error(`expected a parsed document: ${result.reason}`);
    const [shape] = result.document.canvas!.shapes;
    expect(shape.anchor).toBeNull();
    expect(shape.x).toBe(320);
    expect(result.document.canvas!.connectors[0].to).toEqual({
      attach: "free",
      x: 410,
      y: -40,
    });
    expect(result.warnings).toContainEqual({
      kind: "unresolved-anchor",
      count: 2,
    });
  });

  it("leaves a reference into a layer this document does not carry alone", () => {
    // Arrange: an anchor into the live work layer, which is never in the file.
    const raw = drawnDocument();
    raw.canvas.shapes[0].anchor = {
      layer: "work",
      node: "cycle:abc",
      dx: 0,
      dy: 0,
    };
    raw.canvas.connectors[0].to = {
      attach: "derived",
      layer: "work",
      node: "agent:xyz",
      side: null,
    };

    // Act
    const result = parseProjectMap(JSON.stringify(raw));

    // Assert: untouched. Repairing it would delete every annotation the user
    // attached to running work the moment the file is read.
    if (!result.ok) throw new Error(`expected a parsed document: ${result.reason}`);
    expect(result.document.canvas!.shapes[0].anchor).toEqual({
      layer: "work",
      node: "cycle:abc",
      dx: 0,
      dy: 0,
    });
    expect(result.document.canvas!.connectors[0].to).toEqual({
      attach: "derived",
      layer: "work",
      node: "agent:xyz",
      side: null,
    });
    expect(result.warnings).toEqual([]);
  });

  it("releases a line whose shape is gone instead of dropping the line", () => {
    // Arrange
    const raw = drawnDocument();
    raw.canvas.connectors[0].from = {
      attach: "shape",
      shape: "shape-missing",
      side: null,
    };

    // Act
    const result = parseProjectMap(JSON.stringify(raw));

    // Assert
    if (!result.ok) throw new Error(`expected a parsed document: ${result.reason}`);
    expect(result.document.canvas!.connectors).toHaveLength(1);
    expect(result.document.canvas!.connectors[0].from).toEqual({
      attach: "free",
      x: 410,
      y: -40,
    });
    expect(result.warnings).toContainEqual({ kind: "dangling-link", count: 1 });
  });

  it("rejects two drawn shapes sharing an id, because this app generates them", () => {
    // Arrange
    const raw = drawnDocument();
    raw.canvas.shapes.push({ ...raw.canvas.shapes[0] });

    // Act
    const result = parseProjectMap(JSON.stringify(raw));

    // Assert: a locator, not a guess about which one was meant.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid-field");
    expect(result.pointer).toBe("canvas.shapes[1].id");
  });

  it("writes a document nobody has drawn on without adding a canvas block", () => {
    // Arrange: a committed map with no authored layer at all.
    const result = parseProjectMap(JSON.stringify(minimalDocument()));
    if (!result.ok) throw new Error(`expected a parsed document: ${result.reason}`);

    // Act
    const written = serializeProjectMap(result.document);

    // Assert: opening and saving a map nobody drew on must not put an empty
    // block into someone's diff.
    expect(Object.keys(JSON.parse(written) as object)).not.toContain("canvas");
  });

  it("round-trips a drawing so the editor and the file agree", () => {
    // Arrange
    const result = parseProjectMap(JSON.stringify(drawnDocument()));
    if (!result.ok) throw new Error(`expected a parsed document: ${result.reason}`);

    // Act
    const again = parseProjectMap(serializeProjectMap(result.document));

    // Assert
    if (!again.ok) throw new Error(`expected a parsed document: ${again.reason}`);
    expect(again.document.canvas).toEqual(result.document.canvas);
  });
});
