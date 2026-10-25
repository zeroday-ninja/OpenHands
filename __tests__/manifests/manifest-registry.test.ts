import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSetupRegistry } from "#/manifests/manifest-registry";
import {
  createSetup,
  createSetupEntry,
  createSetupEntryWith,
} from "./manifest-test-data";

describe("createSetupRegistry", () => {
  beforeEach(() => {
    // Rejections are reported for the manifest author, not the user.
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves an admitted manifest by its id", () => {
    // Arrange
    const entry = createSetupEntry();
    const registry = createSetupRegistry([entry]);

    // Act
    const resolved = registry.findById("widget-monitor");

    // Assert
    expect(resolved).toBe(entry);
  });

  it("claims no id the catalog did not offer", () => {
    // Arrange
    const registry = createSetupRegistry([createSetupEntry()]);

    // Act
    const resolved = registry.findById("something-else");

    // Assert
    expect(resolved).toBeNull();
  });

  it("passes over a catalog entry that ships no setup experience", () => {
    // Arrange — a card-only entry is the normal case, not a rejection.
    const cardOnly = { id: "card-only", name: "Card only" };

    // Act
    const registry = createSetupRegistry([cardOnly, createSetupEntry()]);

    // Assert
    expect(registry.entries).toHaveLength(1);
  });

  it("drops a manifest that fails admission instead of rendering part of it", () => {
    // Arrange
    const rejected = createSetupEntryWith({
      setup: createSetup({ version: "2.0" as "1.0" }),
    });

    // Act
    const registry = createSetupRegistry([rejected, createSetupEntry()]);

    // Assert
    expect(registry.entries).toHaveLength(1);
  });

  it("says why it refused, so the page for that id can explain itself", () => {
    // A refusal used to be a `console.warn` and nothing else, so the setup
    // page for a refused entry fell through to the automation lookup and told
    // the reader there was no such automation. "Published and refused" and
    // "nobody published this" are different claims and the reader needs the
    // difference: one is a package defect, the other is a dead link.
    const refused = createSetupEntryWith({
      setup: createSetup({ version: "2.0" as "1.0" }),
    });

    const registry = createSetupRegistry([refused]);

    expect(registry.entries).toEqual([]);
    expect(registry.rejections).toHaveLength(1);
    // The id is read off the raw candidate, because it may be the one field
    // that *was* valid and it is what makes the rejection addressable.
    expect(registry.rejectionFor("widget-monitor")?.reason).toBeTruthy();
    // And an id nobody offered is still nothing, not a refusal.
    expect(registry.rejectionFor("never-published")).toBeNull();
  });

  it("records a hijack attempt as a refusal rather than only dropping it", () => {
    const first = createSetupEntry({ name: "First" });
    const second = createSetupEntry({ name: "Second" });

    const registry = createSetupRegistry([first, second]);

    // The surviving entry is still the first one — and the second's refusal
    // is addressable, which is what tells a package author why their entry
    // never appeared.
    expect(registry.findById("widget-monitor")).toBe(first);
    expect(registry.rejectionFor("widget-monitor")?.reason).toContain(
      "already registered",
    );
  });

  it("keeps the first claim on an id so a later manifest cannot hijack it", () => {
    // Arrange
    const first = createSetupEntry({ name: "First" });
    const second = createSetupEntry({ name: "Second" });

    // Act
    const registry = createSetupRegistry([first, second]);

    // Assert
    expect(registry.findById("widget-monitor")).toBe(first);
  });
});
