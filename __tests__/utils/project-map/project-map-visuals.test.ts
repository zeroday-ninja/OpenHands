import { describe, expect, it } from "vitest";
import {
  PROJECT_MAP_ACCENT_COUNT,
  projectMapAccentToken,
  projectMapEdgeGeometry,
  projectMapEdgeHeadPath,
  projectMapEdgeStyle,
  projectMapSilhouette,
  resolveProjectMapAccent,
} from "#/utils/project-map/project-map-visuals";
import {
  PROJECT_MAP_EDGE_KINDS,
  PROJECT_MAP_NODE_KINDS,
} from "#/types/project-map";

describe("resolveProjectMapAccent", () => {
  it("wraps an out-of-range index instead of refusing to draw", () => {
    // Arrange / Act
    const accent = resolveProjectMapAccent(
      String(PROJECT_MAP_ACCENT_COUNT + 2),
      "web",
    );

    // Assert
    expect(accent).toBe(2);
  });

  it("gives an undeclared group a stable colour, and spreads groups across the palette", () => {
    // Arrange
    const groupIds = [
      "web",
      "rendering",
      "persistence",
      "transport",
      "events",
      "settings",
      "automation",
      "terminal",
    ];

    // Act
    const accents = groupIds.map((id) => resolveProjectMapAccent(null, id));

    // Assert: stable for the same id, in range, and not all one colour.
    expect(accents).toEqual(
      groupIds.map((id) => resolveProjectMapAccent(null, id)),
    );
    for (const accent of accents) {
      expect(accent).toBeGreaterThanOrEqual(1);
      expect(accent).toBeLessThanOrEqual(PROJECT_MAP_ACCENT_COUNT);
    }
    expect(new Set(accents).size).toBeGreaterThanOrEqual(4);
  });

  it("resolves to a theme token rather than a colour, in both directions", () => {
    // Act / Assert: the map follows the theme, so no literal colour escapes.
    for (let accent = 1; accent <= PROJECT_MAP_ACCENT_COUNT; accent += 1) {
      expect(projectMapAccentToken(accent)).toBe(
        `var(--color-map-accent-${accent})`,
      );
    }
    expect(projectMapAccentToken(99)).toBe(
      `var(--color-map-accent-${PROJECT_MAP_ACCENT_COUNT})`,
    );
  });
});

describe("projectMapSilhouette", () => {
  it("gives every node kind its own drawn shape, so shape can be read instead of text", () => {
    // Act: a shape is its outline plus the inner rules that complete it, which
    // is how a plain module, a window with a title bar and a two-rule table
    // stay apart while sharing a rectangle.
    const shapes = PROJECT_MAP_NODE_KINDS.map((kind) => {
      const silhouette = projectMapSilhouette(kind, 160, 48);
      return `${silhouette.outline}|${silhouette.detail ?? ""}`;
    });

    // Assert
    expect(new Set(shapes).size).toBe(PROJECT_MAP_NODE_KINDS.length);
    for (const shape of shapes) expect(shape.startsWith("M")).toBe(true);
  });

  it("dashes only the outline of something outside the repository", () => {
    // Act
    const dashed = PROJECT_MAP_NODE_KINDS.filter(
      (kind) => projectMapSilhouette(kind, 160, 48).dashed,
    );

    // Assert
    expect(dashed).toEqual(["external"]);
  });
});

describe("projectMapEdgeStyle", () => {
  it("distinguishes every edge kind by dash and head together", () => {
    // Act
    const signatures = PROJECT_MAP_EDGE_KINDS.map((kind) => {
      const style = projectMapEdgeStyle(kind);
      return `${style.dash ?? "solid"}/${style.head}/${style.weight}`;
    });

    // Assert
    expect(new Set(signatures).size).toBe(PROJECT_MAP_EDGE_KINDS.length);
  });
});

describe("projectMapEdgeGeometry", () => {
  it("leaves and arrives on the sides facing each other when the run is horizontal", () => {
    // Arrange
    const from = { x: 0, y: 0, width: 100, height: 40 };
    const to = { x: 400, y: 0, width: 100, height: 40 };

    // Act
    const geometry = projectMapEdgeGeometry(from, to);

    // Assert: out of the right edge, into the left edge, pointing right.
    expect(geometry.d).toBe("M100 20H250V20H400");
    expect(geometry.tip).toEqual({ x: 400, y: 20 });
    expect(geometry.direction).toBe("right");
  });

  it("switches to the vertical sides when the run is mostly vertical", () => {
    // Arrange
    const from = { x: 0, y: 0, width: 100, height: 40 };
    const to = { x: 0, y: 400, width: 100, height: 40 };

    // Act
    const geometry = projectMapEdgeGeometry(from, to);

    // Assert
    expect(geometry.direction).toBe("down");
    expect(geometry.d.startsWith("M50 40V")).toBe(true);
  });

  it("points the head back along the line it arrived on", () => {
    // Act
    const rightward = projectMapEdgeHeadPath(
      "filled",
      { x: 100, y: 50 },
      "right",
    );
    const upward = projectMapEdgeHeadPath("filled", { x: 100, y: 50 }, "up");

    // Assert: the base of each head sits behind the tip, on the travel axis.
    expect(rightward).toBe("M100 50L91 46L91 54Z");
    expect(upward).toBe("M100 50L96 59L104 59Z");
  });

  it("draws nothing for a headless edge", () => {
    // Act / Assert
    expect(projectMapEdgeHeadPath("none", { x: 0, y: 0 }, "right")).toBeNull();
  });
});
