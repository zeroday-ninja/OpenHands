import { describe, expect, it, vi } from "vitest";
import { createInterfaceManifest } from "../manifests/manifest-test-data";

/**
 * A manifest that was published and refused is not the same as none at all.
 *
 * Both close the automation surface, and the only thing that told them apart
 * was a browser-console warning. So every automation page answered "not
 * found" — sending someone to look for a page that the pinned package had
 * taken away from them, with nothing anywhere saying so. A 404 belongs to the
 * deployment that genuinely has no automation interface.
 */
vi.mock("#/manifests/manifest-sources", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("#/manifests/manifest-sources")>();
  return {
    ...actual,
    AUTOMATION_INTERFACE_CANDIDATE: createInterfaceManifest({
      version: "2.0" as "1.0",
    }),
  };
});

vi.spyOn(console, "warn").mockImplementation(() => {});

function statusOfLoader(load: () => unknown): number | "no-throw" {
  try {
    load();
  } catch (error) {
    return error instanceof Response ? error.status : -1;
  }
  return "no-throw";
}

describe("the automation routes when the published manifest was refused", () => {
  it("does not 404 any automation route", async () => {
    // Arrange
    const [list, detail, setup, templates] = await Promise.all([
      import("#/routes/automations-list"),
      import("#/routes/automation-detail"),
      import("#/routes/automation-setup-route"),
      import("#/routes/automation-templates"),
    ]);

    // Act & Assert — every one reaches its component, which is where the
    // reason is shown.
    expect({
      list: statusOfLoader(() => list.clientLoader()),
      detail: statusOfLoader(() => detail.clientLoader()),
      setup: statusOfLoader(() =>
        setup.clientLoader({
          params: { automationId: "github-pr-reviewer" },
        } as Parameters<typeof setup.clientLoader>[0]),
      ),
      templates: statusOfLoader(() => templates.clientLoader()),
    }).toEqual({
      list: "no-throw",
      detail: "no-throw",
      setup: "no-throw",
      templates: "no-throw",
    });
  });

  it("names the field that made the manifest unusable", async () => {
    // The validator's own words, which is the part that makes this
    // actionable rather than just alarming.
    const seam = await import("#/manifests/automation-interface");

    expect(seam.automationInterfaceRejection()).toMatch(/version/i);
  });
});
