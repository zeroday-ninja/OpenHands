import { beforeEach, describe, expect, it } from "vitest";
import { useProjectMapStore } from "#/stores/project-map-store";
import {
  PROJECT_MAP_VERSION,
  type PlacedProjectMapDocument,
} from "#/types/project-map";
import { defaultProjectMapCanvas } from "#/utils/project-map/project-map-authoring";

function document(
  canvas = defaultProjectMapCanvas(),
): PlacedProjectMapDocument {
  return {
    version: PROJECT_MAP_VERSION,
    generated_at: null,
    commit: "abc1234",
    groups: [],
    nodes: [],
    edges: [],
    notes: [],
    canvas,
  };
}

describe("which layer is on the paper", () => {
  beforeEach(() => useProjectMapStore.getState().reset());

  it("is this session's business, not a change to the repository's map", () => {
    // Arrange
    useProjectMapStore.getState().hydrate("revision-1", document());
    expect(useProjectMapStore.getState().layer).toBe("code");

    // Act: look at what the agents are doing right now.
    useProjectMapStore.getState().setLayer("work");

    // Assert: the paper changed, the file did not — looking at live work
    // used to mark the map unsaved and, once saved, told every machine that
    // opened the repository to start on the agents rather than the code.
    const after = useProjectMapStore.getState();
    expect(after.layer).toBe("work");
    expect(after.dirty).toBe(false);
    expect(after.document?.canvas).toEqual(defaultProjectMapCanvas());
    expect(after.past).toEqual([]);
  });

  it("opens on the layer a document names, and leaves it there", () => {
    // Arrange: a map committed while someone was on the work layer.
    const canvas = defaultProjectMapCanvas();
    const stored = {
      ...canvas,
      view: { ...canvas.view, layer: "work" as const },
    };

    // Act
    useProjectMapStore.getState().hydrate("revision-1", document(stored));

    // Assert
    expect(useProjectMapStore.getState().layer).toBe("work");
    useProjectMapStore.getState().setLayer("code");
    expect(useProjectMapStore.getState().document?.canvas.view.layer).toBe(
      "work",
    );
  });
});
