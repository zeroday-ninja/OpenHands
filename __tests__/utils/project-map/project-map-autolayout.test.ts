import { describe, expect, it } from "vitest";
import type { ProjectMapConnector, ProjectMapShape } from "#/types/project-map";
import {
  layoutProjectMapLayered,
  layoutProjectMapRadial,
  layoutProjectMapShapes,
  layoutProjectMapTree,
} from "#/utils/project-map/project-map-autolayout";

type Positions = Map<string, { x: number; y: number }>;

function shape(
  overrides: Partial<ProjectMapShape> & { id: string },
): ProjectMapShape {
  return {
    kind: "branch",
    text: overrides.id,
    x: 0,
    y: 0,
    width: 200,
    height: 48,
    accent: null,
    parent: null,
    anchor: null,
    pinned: false,
    collapsed: false,
    tags: [],
    ...overrides,
  };
}

function connector(id: string, from: string, to: string): ProjectMapConnector {
  return {
    id,
    from: { attach: "shape", shape: from, side: null },
    to: { attach: "shape", shape: to, side: null },
    waypoints: [],
    dash: "solid",
    head: "filled",
    label: null,
    accent: null,
  };
}

function findShape(shapes: ProjectMapShape[], id: string): ProjectMapShape {
  const subject = shapes.find((candidate) => candidate.id === id);
  if (subject === undefined) throw new Error(`no shape ${id}`);
  return subject;
}

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function rectAt(subject: ProjectMapShape, at: { x: number; y: number }): Rect {
  return {
    left: at.x,
    right: at.x + subject.width,
    top: at.y,
    bottom: at.y + subject.height,
  };
}

function rectOf(
  shapes: ProjectMapShape[],
  positions: Positions,
  id: string,
): Rect {
  const at = positions.get(id);
  if (at === undefined) throw new Error(`no position for ${id}`);
  return rectAt(findShape(shapes, id), at);
}

/** Boxes that merely touch along an edge are not on top of each other. */
function overlapsRect(one: Rect, other: Rect): boolean {
  return (
    one.left < other.right &&
    other.left < one.right &&
    one.top < other.bottom &&
    other.top < one.bottom
  );
}

/** The extent a set of placed shapes covers together. */
function extentOf(
  shapes: ProjectMapShape[],
  positions: Positions,
  ids: string[],
): Rect {
  const rects = ids.map((id) => rectOf(shapes, positions, id));
  return {
    left: Math.min(...rects.map((rect) => rect.left)),
    right: Math.max(...rects.map((rect) => rect.right)),
    top: Math.min(...rects.map((rect) => rect.top)),
    bottom: Math.max(...rects.map((rect) => rect.bottom)),
  };
}

function midpoint(low: number, high: number): number {
  return (low + high) / 2;
}

function centreOf(
  shapes: ProjectMapShape[],
  positions: Positions,
  id: string,
): { x: number; y: number } {
  const rect = rectOf(shapes, positions, id);
  return {
    x: midpoint(rect.left, rect.right),
    y: midpoint(rect.top, rect.bottom),
  };
}

/** Every pair of placed shapes drawn on top of each other, named, for a diff. */
function overlappingPairs(
  shapes: ProjectMapShape[],
  positions: Positions,
): string[] {
  const placed = shapes.filter((candidate) => positions.has(candidate.id));
  const pairs: string[] = [];
  for (let one = 0; one < placed.length; one += 1) {
    for (let other = one + 1; other < placed.length; other += 1) {
      const left = rectOf(shapes, positions, placed[one].id);
      const right = rectOf(shapes, positions, placed[other].id);
      if (overlapsRect(left, right)) {
        pairs.push(`${placed[one].id}/${placed[other].id}`);
      }
    }
  }
  return pairs;
}

function endpointIds(line: ProjectMapConnector): { from: string; to: string } {
  return {
    from: line.from.attach === "shape" ? line.from.shape : "",
    to: line.to.attach === "shape" ? line.to.shape : "",
  };
}

describe("layoutProjectMapTree", () => {
  it("gives sibling subtrees disjoint bands and centres the parent on them", () => {
    // Arrange
    const shapes = [
      shape({ id: "root" }),
      shape({ id: "left", parent: "root" }),
      shape({ id: "right", parent: "root" }),
      shape({ id: "left-a", parent: "left" }),
      shape({ id: "left-b", parent: "left" }),
    ];

    // Act
    const positions = layoutProjectMapTree(shapes, {
      kind: "tree",
      origin: { x: 0, y: 0 },
    });

    // Assert
    const leftBand = extentOf(shapes, positions, ["left", "left-a", "left-b"]);
    const rightBand = extentOf(shapes, positions, ["right"]);
    expect(leftBand.bottom).toBeLessThan(rightBand.top);
    expect(centreOf(shapes, positions, "root").y).toBeCloseTo(
      midpoint(leftBand.top, rightBand.bottom),
    );
    expect(centreOf(shapes, positions, "left").y).toBeCloseTo(
      midpoint(leftBand.top, leftBand.bottom),
    );
  });

  it.each([
    {
      direction: "right" as const,
      ends: (rect: Rect) => rect.right,
      starts: (rect: Rect) => rect.left,
    },
    {
      direction: "down" as const,
      ends: (rect: Rect) => rect.bottom,
      starts: (rect: Rect) => rect.top,
    },
  ])(
    "places each depth clear of the one before it, growing $direction",
    ({ direction, ends, starts }) => {
      // Arrange: a parent far taller than its own child, which is the case a
      // plain subtree-sum band would let a sibling be drawn on top of.
      const shapes = [
        shape({ id: "root" }),
        shape({ id: "tall", parent: "root", width: 120, height: 400 }),
        shape({ id: "tall-child", parent: "tall" }),
        shape({ id: "sibling", parent: "root" }),
      ];

      // Act
      const positions = layoutProjectMapTree(shapes, {
        kind: "tree",
        origin: { x: 0, y: 0 },
        direction,
      });

      // Assert
      expect(overlappingPairs(shapes, positions)).toEqual([]);
      for (const [parent, child] of [
        ["root", "tall"],
        ["tall", "tall-child"],
      ]) {
        expect(starts(rectOf(shapes, positions, child))).toBeGreaterThan(
          ends(rectOf(shapes, positions, parent)),
        );
      }
    },
  );

  it("treats a parent that is not in the input as a root", () => {
    // Arrange
    const shapes = [
      shape({ id: "root" }),
      shape({ id: "orphan", parent: "deleted-long-ago" }),
    ];

    // Act
    const positions = layoutProjectMapTree(shapes, {
      kind: "tree",
      origin: { x: 0, y: 0 },
    });

    // Assert
    expect(rectOf(shapes, positions, "orphan").left).toEqual(
      rectOf(shapes, positions, "root").left,
    );
    expect(overlappingPairs(shapes, positions)).toEqual([]);
  });

  it("places every shape when a parent chain is a cycle", () => {
    // Arrange: hand-edited into a loop, with one shape hanging off it.
    const shapes = [
      shape({ id: "a", parent: "b" }),
      shape({ id: "b", parent: "c" }),
      shape({ id: "c", parent: "a" }),
      shape({ id: "leaf", parent: "b" }),
    ];

    // Act
    const positions = layoutProjectMapTree(shapes, {
      kind: "tree",
      origin: { x: 0, y: 0 },
    });

    // Assert
    expect([...positions.keys()].sort()).toEqual(["a", "b", "c", "leaf"]);
    expect(overlappingPairs(shapes, positions)).toEqual([]);
  });
});

describe("layoutProjectMapRadial", () => {
  it("puts siblings on one ring at distinct angles", () => {
    // Arrange: deliberately different widths, so an arrangement that put
    // corners on the ring instead of centres would not come out even.
    const origin = { x: 500, y: 400 };
    const shapes = [
      shape({ id: "hub" }),
      shape({ id: "spoke-a", parent: "hub" }),
      shape({ id: "spoke-b", parent: "hub", width: 160 }),
      shape({ id: "spoke-c", parent: "hub", width: 240 }),
    ];

    // Act
    const positions = layoutProjectMapRadial(shapes, {
      kind: "radial",
      origin,
    });

    // Assert
    expect(centreOf(shapes, positions, "hub").x).toBeCloseTo(origin.x);
    expect(centreOf(shapes, positions, "hub").y).toBeCloseTo(origin.y);

    const spokes = ["spoke-a", "spoke-b", "spoke-c"].map((id) => {
      const { x, y } = centreOf(shapes, positions, id);
      return {
        radius: Math.hypot(x - origin.x, y - origin.y),
        angle: Math.atan2(y - origin.y, x - origin.x),
      };
    });
    expect(spokes[0].radius).toBeGreaterThan(0);
    expect(spokes[1].radius).toBeCloseTo(spokes[0].radius);
    expect(spokes[2].radius).toBeCloseTo(spokes[0].radius);
    expect(new Set(spokes.map((spoke) => spoke.angle.toFixed(6))).size).toEqual(
      3,
    );
  });
});

describe("layoutProjectMapLayered", () => {
  it("puts every connector's target in a later layer than its source", () => {
    // Arrange: "a -> c" spans two layers, so the longest path decides c.
    const shapes = ["a", "b", "c", "unconnected"].map((id) => shape({ id }));
    const connectors = [
      connector("conn-1", "a", "b"),
      connector("conn-2", "b", "c"),
      connector("conn-3", "a", "c"),
    ];

    // Act
    const positions = layoutProjectMapLayered(shapes, {
      kind: "layered",
      origin: { x: 0, y: 0 },
      connectors,
    });

    // Assert
    for (const line of connectors) {
      const { from, to } = endpointIds(line);
      expect(rectOf(shapes, positions, to).left).toBeGreaterThan(
        rectOf(shapes, positions, from).right,
      );
    }
    expect(positions.has("unconnected")).toBe(true);
    expect(overlappingPairs(shapes, positions)).toEqual([]);
  });

  it("still lays out a graph whose connectors form a cycle", () => {
    // Arrange
    const shapes = ["a", "b", "c"].map((id) => shape({ id }));
    const connectors = [
      connector("conn-1", "a", "b"),
      connector("conn-2", "b", "c"),
      connector("conn-3", "c", "a"),
    ];

    // Act
    const positions = layoutProjectMapLayered(shapes, {
      kind: "layered",
      origin: { x: 0, y: 0 },
      connectors,
    });

    // Assert: every shape is placed, and only the one line that closes the
    // cycle runs backwards — the rest still read source before target.
    expect([...positions.keys()].sort()).toEqual(["a", "b", "c"]);
    const forwards = connectors.filter((line) => {
      const { from, to } = endpointIds(line);
      return (
        rectOf(shapes, positions, to).left >
        rectOf(shapes, positions, from).right
      );
    });
    expect(forwards).toHaveLength(2);
  });
});

describe("layoutProjectMapShapes", () => {
  it("leaves pinned and anchored shapes where they were", () => {
    // Arrange: the origin sits inside the box the untouchable shapes occupy.
    const shapes = [
      shape({ id: "pinned", pinned: true, x: 0, y: 0 }),
      shape({
        id: "anchored",
        x: 300,
        y: 0,
        anchor: { layer: "code", node: "src/thing.ts", dx: 0, dy: 0 },
      }),
      shape({ id: "free-root" }),
      shape({ id: "free-child", parent: "free-root" }),
    ];
    const before = structuredClone(shapes);

    // Act
    const positions = layoutProjectMapShapes(shapes, {
      kind: "tree",
      origin: { x: 0, y: 0 },
    });

    // Assert
    expect([...positions.keys()].sort()).toEqual(["free-child", "free-root"]);
    const landedOnFixed = [...positions]
      .filter(([movedId, at]) =>
        ["pinned", "anchored"].some((fixedId) => {
          const fixed = findShape(shapes, fixedId);
          return overlapsRect(
            rectAt(findShape(shapes, movedId), at),
            rectAt(fixed, { x: fixed.x, y: fixed.y }),
          );
        }),
      )
      .map(([movedId]) => movedId);
    expect(landedOnFixed).toEqual([]);
    expect(shapes).toEqual(before);
  });

  it("moves nothing under the free layout", () => {
    // Arrange
    const shapes = [
      shape({ id: "root" }),
      shape({ id: "child", parent: "root" }),
    ];

    // Act
    const positions = layoutProjectMapShapes(shapes, {
      kind: "free",
      origin: { x: 0, y: 0 },
    });

    // Assert
    expect(positions.size).toEqual(0);
  });
});
