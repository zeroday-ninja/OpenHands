import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithProviders } from "test-utils";
import { WorkbenchBoard } from "#/components/features/workbench/workbench-board";
import { WORKBENCH_DRAG_TYPES } from "#/components/features/workbench/workbench-controls";
import { useWorkbenchStore } from "#/stores/workbench-store";
import type { WorkbenchWorkItem } from "#/types/workbench";
import { workbenchExampleDocument } from "#/utils/workbench/workbench-seed";

const itemTransfer = (itemId: string) => ({
  types: [WORKBENCH_DRAG_TYPES.item],
  getData: (key: string) => (key === WORKBENCH_DRAG_TYPES.item ? itemId : ""),
  setData: vi.fn(),
  dropEffect: "none",
  effectAllowed: "all",
});

/** Renders the board the way the page does: from the live store document. */
function Harness({ onStart }: { onStart: (item: WorkbenchWorkItem) => void }) {
  const doc = useWorkbenchStore((s) => s.document);
  // Stores are reset after each test while the tree is still mounted.
  if (!doc) return null;
  return (
    <WorkbenchBoard
      document={doc}
      openMenu={vi.fn()}
      showToast={vi.fn()}
      onAsk={vi.fn()}
      onShowPart={vi.fn()}
      onStart={onStart}
    />
  );
}

function renderBoard() {
  const onStart = vi.fn();
  const view = renderWithProviders(<Harness onStart={onStart} />);
  return { ...view, onStart };
}

const doc = () => useWorkbenchStore.getState().document!;

describe("WorkbenchBoard", () => {
  beforeEach(() => {
    useWorkbenchStore.setState({ source: null, document: null });
    useWorkbenchStore.getState().hydrate("rev-1", workbenchExampleDocument());
  });

  it("opens on the active sprint with its stories in their lanes", () => {
    renderBoard();

    expect(screen.getByTestId("workbench-sprint-tab-s12")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      within(screen.getByTestId("workbench-lane-build")).getByTestId(
        "workbench-card-w1",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("workbench-lane-backlog")).getByTestId(
        "workbench-card-w4",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("workbench-card-w7")).not.toBeInTheDocument();
  });

  it("moves a story to the lane it is dropped on", () => {
    renderBoard();

    fireEvent.drop(screen.getByTestId("workbench-lane-build"), {
      dataTransfer: itemTransfer("w4"),
    });

    expect(doc().work.find((w) => w.id === "w4")?.stage).toBe("build");
  });

  it("moves a story into another sprint when dropped on its tab", () => {
    renderBoard();

    fireEvent.drop(screen.getByTestId("workbench-sprint-tab-s13"), {
      dataTransfer: itemTransfer("w4"),
    });

    expect(doc().work.find((w) => w.id === "w4")?.sprintId).toBe("s13");
  });

  it("plans the next sprint from the backlog with one click", () => {
    renderBoard();

    fireEvent.click(screen.getByTestId("workbench-sprint-tab-s13"));
    fireEvent.click(screen.getByTestId("workbench-plan-sprint"));

    const planned = doc().work.filter((w) => w.sprintId === "s13");
    expect(planned).toHaveLength(6);
    expect(planned.map((w) => w.id)).toEqual(
      expect.arrayContaining(["w13", "w14"]),
    );
  });

  it("adds a story to the shown sprint from the new story form", () => {
    renderBoard();

    fireEvent.change(screen.getByTestId("workbench-new-story"), {
      target: { value: "Role badges in the header" },
    });
    fireEvent.submit(screen.getByTestId("workbench-new-story"));

    const added = doc().work.find(
      (w) => w.title === "Role badges in the header",
    );
    expect(added).toMatchObject({ sprintId: "s12", stage: "backlog" });
    expect(
      screen.getByTestId(`workbench-card-${added!.id}`),
    ).toBeInTheDocument();
  });
});
