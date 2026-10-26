import { describe, expect, it } from "vitest";
import {
  PROJECT_MAP_OVERVIEW_BLOCK,
  PROJECT_MAP_OVERVIEW_GAP,
  PROJECT_MAP_OVERVIEW_THRESHOLD,
  projectMapOverview,
  projectMapWantsOverview,
} from "#/utils/project-map/project-map-overview";
import type {
  PlacedProjectMapDocument,
  PlacedProjectMapNode,
} from "#/types/project-map";
import { PROJECT_MAP_VERSION } from "#/types/project-map";
import { defaultProjectMapCanvas } from "#/utils/project-map/project-map-authoring";

function node(
  id: string,
  group: string | null,
  overrides: Partial<PlacedProjectMapNode> = {},
): PlacedProjectMapNode {
  return {
    id,
    kind: "module",
    label: id,
    path: id,
    group,
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
  nodes: PlacedProjectMapNode[],
  edges: PlacedProjectMapDocument["edges"] = [],
): PlacedProjectMapDocument {
  return {
    version: PROJECT_MAP_VERSION,
    generated_at: null,
    commit: null,
    groups: [
      { id: "web", label: "Web app", accent: "1", collapsed: false },
      { id: "api", label: "API", accent: "2", collapsed: false },
      { id: "data", label: "Data", accent: "3", collapsed: true },
    ],
    nodes,
    edges,
    notes: [],
    canvas: defaultProjectMapCanvas(),
  };
}

describe("projectMapOverview", () => {
  it("says where each layer's parts live, in the repository's own words", () => {
    // Arrange: everything under src/, so src/ says nothing and is stripped;
    // an external part has no path and names no folder.
    const overview = projectMapOverview(
      document([
        node("src/web/a.ts", "web"),
        node("src/web/b.ts", "web"),
        node("src/web/c.ts", "web"),
        node("src/public/d.css", "web"),
        node("src/public/e.css", "web"),
        node("src/scripts/f.ts", "web"),
        node("src/index.ts", "web"),
        node("src/api/g.ts", "api"),
        node("ext:stripe", "api", { path: null }),
        node("src/server/research/x.ts", "data"),
        node("src/server/research/y.ts", "data"),
        node("src/server/engine/z.ts", "data"),
        node("src/server/char.ts", "data"),
      ]),
    );

    // Assert: a layer sharing no folder names its three fullest entries,
    // folders before a lone file; a layer under one folder is named by it
    // and by what inside it holds the most parts, which is a file when the
    // layer's parts are files.
    expect(overview.blocks.map((block) => block.where)).toEqual([
      "web/, public/, scripts/",
      "api/g.ts",
      "server/{research/, engine/, char.ts}",
    ]);
  });

  it("names nothing for a layer with no parts, and a lone part by its file", () => {
    // Every path in a one-part map shares every folder, so the folders say
    // nothing and the file is the whole of what is left to say.
    const overview = projectMapOverview(
      document([node("src/api/g.ts", "api")]),
    );
    expect(overview.blocks.map((block) => block.where)).toEqual([
      "",
      "g.ts",
      "",
    ]);
  });

  it("draws one block per layer with its visible parts, in a near-square grid", () => {
    // Arrange: three layers; one part hidden, one in no layer at all.
    const doc = document([
      node("a", "web"),
      node("b", "web"),
      node("c", "web", { hidden: true }),
      node("d", "api"),
      node("e", null),
    ]);

    // Act
    const overview = projectMapOverview(doc);

    // Assert: blocks follow the document's layer order and count only what is
    // drawn; the part outside any layer is counted, not lost.
    expect(
      overview.blocks.map((block) => [block.group.id, block.count]),
    ).toEqual([
      ["web", 2],
      ["api", 1],
      ["data", 0],
    ]);
    expect(overview.ungrouped).toBe(1);
    // Three layers: two per row, so the third starts a second row.
    const pitchX = PROJECT_MAP_OVERVIEW_BLOCK.width + PROJECT_MAP_OVERVIEW_GAP;
    const pitchY = PROJECT_MAP_OVERVIEW_BLOCK.height + PROJECT_MAP_OVERVIEW_GAP;
    expect(overview.blocks.map((block) => [block.x, block.y])).toEqual([
      [0, 0],
      [pitchX, 0],
      [0, pitchY],
    ]);
    expect(overview.bounds).toEqual({
      x: 0,
      y: 0,
      width: 2 * pitchX - PROJECT_MAP_OVERVIEW_GAP,
      height: pitchY + PROJECT_MAP_OVERVIEW_BLOCK.height,
    });
  });

  it("folds the relations between layers by direction and leaves the ones inside a layer out", () => {
    // Arrange
    const doc = document(
      [node("a", "web"), node("b", "web"), node("c", "api"), node("d", "data")],
      [
        { from: "a", to: "c", kind: "calls", label: null },
        { from: "b", to: "c", kind: "reads", label: null },
        { from: "c", to: "a", kind: "publishes", label: null },
        { from: "a", to: "b", kind: "imports", label: null },
        { from: "c", to: "missing", kind: "calls", label: null },
      ],
    );

    // Act
    const links = projectMapOverview(doc).links;

    // Assert
    expect(links).toEqual([
      { from: "web", to: "api", count: 2, key: "web>api" },
      { from: "api", to: "web", count: 1, key: "api>web" },
    ]);
  });

  it("wants an overview only for a map that is a wall, with layers to show", () => {
    const many = Array.from(
      { length: PROJECT_MAP_OVERVIEW_THRESHOLD + 1 },
      (_, i) => node(`n${i}`, i % 2 === 0 ? "web" : "api"),
    );
    expect(projectMapWantsOverview(document(many))).toBe(true);
    expect(projectMapWantsOverview(document(many.slice(0, 10)))).toBe(false);
    // Hidden parts do not count towards the wall.
    expect(
      projectMapWantsOverview(
        document(many.map((n) => ({ ...n, hidden: true }))),
      ),
    ).toBe(false);
    // One layer is not an overview of anything.
    expect(
      projectMapWantsOverview({
        ...document(many),
        groups: [
          { id: "web", label: "Web app", accent: "1", collapsed: false },
        ],
      }),
    ).toBe(false);
  });
});
