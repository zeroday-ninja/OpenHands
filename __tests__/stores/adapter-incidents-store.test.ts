import { describe, expect, it, vi } from "vitest";

async function loadFreshStore() {
  window.localStorage.clear();
  vi.resetModules();
  return import("#/stores/adapter-incidents-store");
}

describe("adapter incidents store", () => {
  it("claims a sighting once and remembers what filing it came to", async () => {
    const { useAdapterIncidentsStore, adapterIncidentKey } =
      await loadFreshStore();
    const key = adapterIncidentKey({
      conversationId: "c1",
      adapter: "antigravity",
      what: "step",
      kind: "review_note",
    });
    const sighting = {
      conversationId: "c1",
      adapter: "antigravity",
      what: "step",
      kind: "review_note",
      at: "2026-10-26T05:00:00Z",
    };

    useAdapterIncidentsStore.getState().begin(key, sighting);
    // Claimed: neither filed nor failed yet.
    expect(useAdapterIncidentsStore.getState().records[key]).toMatchObject({
      lessonId: null,
      error: null,
    });

    useAdapterIncidentsStore.getState().settle(key, { lessonId: "L1" });
    expect(useAdapterIncidentsStore.getState().records[key].lessonId).toBe(
      "L1",
    );
    // Written through, so a reload does not file it again.
    expect(
      JSON.parse(window.localStorage.getItem("adapter-incidents") ?? "{}").state
        .records[key].lessonId,
    ).toBe("L1");

    // A failure is kept in the service's words, in place of a lesson.
    useAdapterIncidentsStore.getState().settle(key, { error: "503" });
    expect(useAdapterIncidentsStore.getState().records[key]).toMatchObject({
      lessonId: null,
      error: "503",
    });
    // Settling something never claimed changes nothing.
    useAdapterIncidentsStore.getState().settle("ghost", { lessonId: "L2" });
    expect(useAdapterIncidentsStore.getState().records.ghost).toBeUndefined();
  });

  it("keys a sighting by conversation, adapter, what and kind", async () => {
    const { adapterIncidentKey } = await loadFreshStore();
    const base = {
      conversationId: "c1",
      adapter: "antigravity",
      what: "step",
      kind: "x",
    };
    expect(adapterIncidentKey(base)).toBe(adapterIncidentKey({ ...base }));
    expect(adapterIncidentKey({ ...base, conversationId: "c2" })).not.toBe(
      adapterIncidentKey(base),
    );
    expect(adapterIncidentKey({ ...base, kind: null })).not.toBe(
      adapterIncidentKey(base),
    );
  });
});
