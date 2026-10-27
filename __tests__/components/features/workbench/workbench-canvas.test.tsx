import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "test-utils";
import { WorkbenchCanvas } from "#/components/features/workbench/workbench-canvas";
import { WORKBENCH_DRAG_TYPES } from "#/components/features/workbench/workbench-controls";
import type { WorkbenchMenuItem } from "#/components/features/workbench/workbench-context-menu";
import { useWorkbenchStore } from "#/stores/workbench-store";
import { workbenchExampleDocument } from "#/utils/workbench/workbench-seed";

const fakeDataTransfer = (type: string, payload: string) => ({
  types: [type],
  getData: (key: string) => (key === type ? payload : ""),
  setData: vi.fn(),
  dropEffect: "none",
  effectAllowed: "all",
});

type OpenMenu = (
  event: React.MouseEvent,
  items: WorkbenchMenuItem[],
  title?: string,
) => void;

/** Renders the canvas the way the page does: from the live store document. */
function Harness({
  openMenu,
  showToast,
  onAsk,
}: {
  openMenu: OpenMenu;
  showToast: () => void;
  onAsk: () => void;
}) {
  const doc = useWorkbenchStore((s) => s.document);
  // Stores are reset after each test while the tree is still mounted.
  if (!doc) return null;
  const project = doc.projects.find((p) => p.id === "team")!;
  return (
    <WorkbenchCanvas
      document={doc}
      project={project}
      openMenu={openMenu}
      showToast={showToast}
      onAsk={onAsk}
      onCrawl={vi.fn()}
      onAgentDrop={vi.fn()}
      onStoryFor={vi.fn()}
    />
  );
}

function renderCanvas() {
  // The real menu hook stops the event so the paper menu does not open as well.
  const openMenu = vi.fn<OpenMenu>((event) => event.stopPropagation());
  const showToast = vi.fn();
  const onAsk = vi.fn();
  const view = renderWithProviders(
    <Harness openMenu={openMenu} showToast={showToast} onAsk={onAsk} />,
  );
  return { ...view, openMenu, showToast, onAsk };
}

describe("WorkbenchCanvas", () => {
  beforeAll(() => {
    // jsdom has no DragEvent, so drops would lose their pointer position.
    vi.stubGlobal("DragEvent", window.MouseEvent);
  });

  beforeEach(() => {
    useWorkbenchStore.setState({ source: null, document: null });
    useWorkbenchStore.getState().hydrate("rev-1", workbenchExampleDocument());
  });

  it("draws only the repos of the current project, with their parts and wires", () => {
    renderCanvas();

    expect(screen.getByTestId("workbench-group-web")).toBeInTheDocument();
    expect(screen.getByTestId("workbench-part-picker")).toBeInTheDocument();
    expect(
      screen.getByTestId("workbench-wire-table->picker"),
    ).toBeInTheDocument();
    // roles-cli belongs to the other project only.
    expect(screen.queryByTestId("workbench-group-cli")).not.toBeInTheDocument();
  });

  it("opens a context menu on a part whose Delete action removes it and offers undo", () => {
    const { openMenu, showToast } = renderCanvas();

    fireEvent.contextMenu(screen.getByTestId("workbench-part-picker"));

    expect(openMenu).toHaveBeenCalledTimes(1);
    const [, items, title] = openMenu.mock.calls[0];
    expect(title).toBe("RolePicker");
    expect(items.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        "ask",
        "story",
        "rename",
        "status",
        "move",
        "delete",
      ]),
    );

    items.find((item) => item.id === "delete")!.onSelect!();

    expect(
      useWorkbenchStore
        .getState()
        .document!.parts.some((p) => p.id === "picker"),
    ).toBe(false);
    expect(showToast).toHaveBeenCalledWith(expect.any(String), true);
  });

  it("adds a new part to the repo a library tile is dropped on and starts renaming it", () => {
    renderCanvas();
    const before = useWorkbenchStore.getState().document!.parts.length;

    fireEvent.drop(screen.getByTestId("workbench-canvas"), {
      clientX: 150,
      clientY: 200,
      dataTransfer: fakeDataTransfer(WORKBENCH_DRAG_TYPES.libraryPart, "hook"),
    });

    const parts = useWorkbenchStore.getState().document!.parts;
    expect(parts).toHaveLength(before + 1);
    const added = parts[parts.length - 1];
    expect(added).toMatchObject({
      repoId: "web",
      kind: "hook",
      status: "planned",
    });
    expect(useWorkbenchStore.getState().selection.partIds).toEqual([added.id]);
    expect(
      screen.getByTestId(`workbench-rename-${added.id}`),
    ).toBeInTheDocument();
  });

  it("selects a part on click and shows which agent is working on it", () => {
    renderCanvas();

    fireEvent.pointerDown(screen.getByTestId("workbench-part-picker"), {
      button: 0,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerUp(screen.getByTestId("workbench-part-picker"), {
      button: 0,
      clientX: 0,
      clientY: 0,
    });

    expect(useWorkbenchStore.getState().selection.partIds).toEqual(["picker"]);
    expect(screen.getByTestId("workbench-agent-badge-ui")).toBeInTheDocument();
  });
});
