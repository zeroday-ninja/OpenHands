import { describe, expect, it } from "vitest";
import {
  projectMapWaitingLayers,
  projectMapWaitingParts,
} from "#/utils/project-map/project-map-waiting-parts";
import type { ImproveCycle } from "#/types/improve";
import {
  PROJECT_MAP_VERSION,
  type PlacedProjectMapDocument,
  type PlacedProjectMapNode,
} from "#/types/project-map";
import { defaultProjectMapCanvas } from "#/utils/project-map/project-map-authoring";

function node(id: string, group: string | null): PlacedProjectMapNode {
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
  };
}

const DOCUMENT: PlacedProjectMapDocument = {
  version: PROJECT_MAP_VERSION,
  generated_at: null,
  commit: null,
  groups: [
    { id: "server", label: "Server", accent: "1", collapsed: false },
    { id: "web", label: "Web", accent: "2", collapsed: false },
  ],
  nodes: [
    node("server/target-source.js", "server"),
    node("server/characterize.js", "server"),
    node("web/app.tsx", "web"),
    { ...node("ext:stripe", "web"), path: null },
  ],
  edges: [],
  notes: [],
  canvas: defaultProjectMapCanvas(),
};

function cycle(
  id: string,
  repository: string,
  plan: ImproveCycle["parked_plan"],
): ImproveCycle {
  return {
    id,
    repository: { label: repository, url: repository, ref: null, index: 0 },
    summary: null,
    branch: null,
    sources: [],
    parked_plan: plan,
  } as unknown as ImproveCycle;
}

describe("what a parked change touches on the map", () => {
  it("marks the parts its own words name, in this repository only", () => {
    // Arrange: one change about this repository, one about another that
    // happens to name a file with the same path.
    const mine = cycle("cycle-1", "https://github.com/zeroday-ninja/HAZARD", {
      breaks: [
        "An export was removed from server/target-source.js: -export function resolveTargetSource",
      ],
      rollback: "Reverting the branch is the fallback.",
    });
    const other = cycle("cycle-2", "pairwatch", {
      breaks: ["More was deleted from web/app.tsx than the threshold allows"],
    });

    // Act
    const parts = projectMapWaitingParts(DOCUMENT, [mine, other], "HAZARD");

    // Assert: the named part carries the change that named it; a file named
    // by a change about another repository is not this map's business, and a
    // part with no path is named by nothing.
    expect([...parts]).toEqual([["server/target-source.js", "cycle-1"]]);
    expect(projectMapWaitingLayers(DOCUMENT, parts)).toEqual(
      new Map([["server", 1]]),
    );
  });

  it("counts only the parts a layer actually shows", () => {
    // Arrange: the named part is hidden, so the layer draws it nowhere and
    // its own part count leaves it out.
    const hidden: PlacedProjectMapDocument = {
      ...DOCUMENT,
      nodes: DOCUMENT.nodes.map((part) =>
        part.id === "server/characterize.js" ? { ...part, hidden: true } : part,
      ),
    };
    const cycles = [
      cycle("cycle-1", "HAZARD", {
        breaks: ["server/characterize.js was deleted"],
      }),
    ];

    // Act
    const parts = projectMapWaitingParts(hidden, cycles, "HAZARD");

    // Assert: still marked, so revealing it shows the mark; not counted,
    // because a block saying three where two marks are drawn is a lie.
    expect(parts.has("server/characterize.js")).toBe(true);
    expect(projectMapWaitingLayers(hidden, parts).size).toBe(0);
  });

  it("marks nothing when no folder is chosen or nothing is parked", () => {
    const mine = cycle("cycle-1", "HAZARD", {
      breaks: ["server/characterize.js was deleted"],
    });

    expect(projectMapWaitingParts(DOCUMENT, [mine], null).size).toBe(0);
    expect(projectMapWaitingParts(DOCUMENT, [], "HAZARD").size).toBe(0);
    expect(projectMapWaitingParts(DOCUMENT, [mine], "HAZARD").size).toBe(1);
  });
});
