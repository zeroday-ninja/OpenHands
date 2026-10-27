import { beforeEach, describe, expect, it } from "vitest";
import { useWorkbenchStore } from "#/stores/workbench-store";
import { workbenchExampleDocument } from "#/utils/workbench/workbench-seed";

const store = () => useWorkbenchStore.getState();
const doc = () => store().document!;

describe("workbench store", () => {
  beforeEach(() => {
    useWorkbenchStore.setState({ source: null, document: null });
    store().hydrate("rev-1", workbenchExampleDocument());
  });

  it("keeps the current buffer when the same file revision is hydrated again", () => {
    store().moveRepo("web", 500, 500);

    store().hydrate("rev-1", workbenchExampleDocument());

    expect(doc().repos.find((r) => r.id === "web")).toMatchObject({
      x: 500,
      y: 500,
    });
    expect(store().dirty).toBe(true);
  });

  it("undoes and redoes a design edit", () => {
    const before = doc().repos.find((r) => r.id === "web")!;

    store().moveRepo("web", 500, 500);
    store().undo();
    expect(doc().repos.find((r) => r.id === "web")).toMatchObject({
      x: before.x,
      y: before.y,
    });

    store().redo();
    expect(doc().repos.find((r) => r.id === "web")).toMatchObject({
      x: 500,
      y: 500,
    });
    expect(store().dirty).toBe(true);
  });

  it("deletes the selected parts together with their wires", () => {
    store().setSelection({ partIds: ["picker"] });

    store().deleteSelection();

    expect(doc().parts.some((p) => p.id === "picker")).toBe(false);
    expect(
      doc().wires.some((w) => w.from === "picker" || w.to === "picker"),
    ).toBe(false);
    expect(store().selection.partIds).toEqual([]);
    // One undo brings the part and its wires back.
    store().undo();
    expect(doc().wires.some((w) => w.to === "picker")).toBe(true);
  });

  it("moves a part into another repo of the project", () => {
    store().movePartToRepo("picker", "api", { x: 10, y: 20 });

    expect(doc().parts.find((p) => p.id === "picker")).toMatchObject({
      repoId: "api",
      x: 10,
      y: 20,
    });
  });

  it("fills a planned sprint from the backlog up to the team velocity, biggest stories first", () => {
    // s13 already holds 16 points against a velocity of 21, so there is room
    // for 5 more. The 8-point story stays behind; the two 2-point items fit.
    const moved = store().planSprint("s13");

    expect(moved).toBe(2);
    const inS13 = doc()
      .work.filter((w) => w.sprintId === "s13")
      .map((w) => w.id);
    expect(inS13).toEqual(expect.arrayContaining(["w13", "w14"]));
    expect(doc().work.find((w) => w.id === "w15")?.sprintId).toBeNull();
  });

  it("closes a sprint, carries unfinished work into the next one and averages velocity", () => {
    store().endSprint("s12");

    const s12 = doc().sprints.find((s) => s.id === "s12")!;
    const s13 = doc().sprints.find((s) => s.id === "s13")!;
    expect(s12.state).toBe("closed");
    expect(s12.review).toBe("5 of 18 points done; 5 carried over.");
    expect(s13.state).toBe("active");
    expect(doc().work.find((w) => w.id === "w1")?.sprintId).toBe("s13");
    expect(doc().work.find((w) => w.id === "w6")?.sprintId).toBe("s12");
    expect(doc().velocity).toBe(13);
  });

  it("adds a story to the active sprint under the next epic key and splits it into smaller ones", () => {
    const id = store().addItem({
      title: "Custom role colours",
      epicId: "e1",
      points: 8,
    })!;

    const added = doc().work.find((w) => w.id === id)!;
    expect(added).toMatchObject({
      key: "ROLE-12",
      stage: "backlog",
      sprintId: "s12",
    });

    store().splitItem(id);
    const parts = doc().work.filter((w) =>
      w.title.startsWith("Custom role colours · part"),
    );
    expect(parts.map((w) => w.points)).toEqual([4, 4]);
    expect(doc().work.some((w) => w.id === id)).toBe(false);
  });
});
