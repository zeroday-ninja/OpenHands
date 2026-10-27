import { describe, expect, it } from "vitest";
import {
  parseWorkbench,
  serializeWorkbench,
} from "#/utils/workbench/parse-workbench";
import { workbenchExampleDocument } from "#/utils/workbench/workbench-seed";

describe("parseWorkbench", () => {
  it("round-trips the example document without warnings", () => {
    const original = workbenchExampleDocument();

    const result = parseWorkbench(serializeWorkbench(original));

    expect(result.failure).toBeNull();
    expect(result.warnings).toEqual([]);
    expect(result.document).toEqual(original);
  });

  it("drops references to parts that are not in the file and says so", () => {
    const original = workbenchExampleDocument();
    const raw = serializeWorkbench({
      ...original,
      parts: original.parts.filter((p) => p.id !== "picker"),
    });

    const result = parseWorkbench(raw);

    expect(result.document?.wires.some((w) => w.to === "picker")).toBe(false);
    expect(result.document?.work.find((w) => w.id === "w1")?.partId).toBeNull();
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("reports a failure for a file that is not JSON", () => {
    const result = parseWorkbench("{ not json");

    expect(result.document).toBeNull();
    expect(result.failure).toBeTruthy();
  });

  it("reads a minimal hand-written file with defaults for everything missing", () => {
    const result = parseWorkbench(
      JSON.stringify({
        repos: [{ id: "app", name: "app" }],
        parts: [{ id: "home", repoId: "app", kind: "route", name: "/" }],
      }),
    );

    expect(result.failure).toBeNull();
    expect(result.document?.parts[0]).toMatchObject({
      status: "built",
      x: 0,
      y: 0,
    });
    expect(result.document?.velocity).toBe(20);
  });
});
