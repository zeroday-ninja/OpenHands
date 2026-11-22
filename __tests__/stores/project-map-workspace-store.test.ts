import { describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "project-map-workspace";

async function loadFreshStore() {
  window.localStorage.clear();
  vi.resetModules();
  return import("#/stores/project-map-workspace-store");
}

describe("project map workspace store", () => {
  it("remembers the chosen folder per backend and across reloads", async () => {
    const { useProjectMapWorkspaceStore, selectionForBackend } =
      await loadFreshStore();

    useProjectMapWorkspaceStore
      .getState()
      .chooseWorkspace("laptop", "/home/me/repos/hazard");

    const state = useProjectMapWorkspaceStore.getState();
    expect(selectionForBackend(state, "laptop").path).toBe(
      "/home/me/repos/hazard",
    );
    // Another machine's paths are its own.
    expect(selectionForBackend(state, "desktop").path).toBeNull();
    // Written through, so a reload finds it.
    expect(
      JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}").state
        .selectionByBackendId.laptop.path,
    ).toBe("/home/me/repos/hazard");
  });

  it("keeps each folder's conversation while switching between them", async () => {
    const {
      useProjectMapWorkspaceStore,
      selectionForBackend,
      boundConversationFor,
    } = await loadFreshStore();
    const { chooseWorkspace, bindConversation } =
      useProjectMapWorkspaceStore.getState();
    const selection = () =>
      selectionForBackend(useProjectMapWorkspaceStore.getState(), "laptop");

    chooseWorkspace("laptop", "/repos/hazard");
    bindConversation("laptop", "/repos/hazard", "conversation-hazard");
    chooseWorkspace("laptop", "/repos/pairwatch");
    bindConversation("laptop", "/repos/pairwatch", "conversation-pairwatch");
    // The backend's own directory, with no folder chosen, has a slot too.
    bindConversation("laptop", null, "conversation-default");

    expect(boundConversationFor(selection(), "/repos/hazard")).toBe(
      "conversation-hazard",
    );
    expect(boundConversationFor(selection(), "/repos/pairwatch")).toBe(
      "conversation-pairwatch",
    );
    expect(boundConversationFor(selection(), null)).toBe(
      "conversation-default",
    );

    // Letting go of one leaves the others bound.
    bindConversation("laptop", "/repos/hazard", null);
    expect(boundConversationFor(selection(), "/repos/hazard")).toBeNull();
    expect(boundConversationFor(selection(), "/repos/pairwatch")).toBe(
      "conversation-pairwatch",
    );
  });
});
