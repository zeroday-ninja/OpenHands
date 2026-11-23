import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "test-utils";
import { WorkbenchSidePanel } from "#/components/features/workbench/workbench-side-panel";
import { WORKBENCH_DRAG_TYPES } from "#/components/features/workbench/workbench-controls";
import { useWorkbenchLayoutStore } from "#/stores/workbench-layout-store";
import { useWorkbenchStore } from "#/stores/workbench-store";
import { workbenchExampleDocument } from "#/utils/workbench/workbench-seed";

function renderPanel() {
  const onTalkTo = vi.fn();
  const onAddRepo = vi.fn();
  const doc = useWorkbenchStore.getState().document!;
  const view = renderWithProviders(
    <WorkbenchSidePanel
      document={doc}
      project={doc.projects.find((p) => p.id === "team")!}
      openMenu={vi.fn()}
      onTalkTo={onTalkTo}
      onAddRepo={onAddRepo}
      onCrawl={vi.fn()}
    />,
  );
  return { ...view, onTalkTo, onAddRepo };
}

describe("WorkbenchSidePanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useWorkbenchLayoutStore.setState({ leftOpen: true, rightOpen: true });
    useWorkbenchStore.setState({ source: null, document: null });
    useWorkbenchStore.getState().hydrate("rev-1", workbenchExampleDocument());
  });

  it("collapses to an icon rail that still offers the team, the parts and the other repos", () => {
    const { unmount } = renderPanel();
    expect(screen.getByTestId("workbench-left-panel")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("workbench-left-close"));

    expect(
      screen.queryByTestId("workbench-left-panel"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("workbench-left-rail")).toBeInTheDocument();
    expect(screen.getByTestId("workbench-rail-role-qa")).toBeInTheDocument();
    expect(screen.getByTestId("workbench-rail-kind-hook")).toBeInTheDocument();
    expect(screen.getByTestId("workbench-rail-repo-cli")).toBeInTheDocument();

    // The drawer stays closed on the next visit.
    unmount();
    renderPanel();
    expect(screen.getByTestId("workbench-left-rail")).toBeInTheDocument();
  });

  it("drags a library tile out as a part kind", () => {
    renderPanel();
    const setData = vi.fn();

    fireEvent.dragStart(screen.getByTestId("workbench-library-hook"), {
      dataTransfer: { setData, types: [], effectAllowed: "all" },
    });

    expect(setData).toHaveBeenCalledWith(
      WORKBENCH_DRAG_TYPES.libraryPart,
      "hook",
    );
  });

  it("opens the chat with a role when its card is clicked", () => {
    const { onTalkTo } = renderPanel();

    fireEvent.click(screen.getByTestId("workbench-role-pm"));

    expect(onTalkTo).toHaveBeenCalledWith(
      expect.objectContaining({ id: "pm" }),
      null,
    );
  });

  it("adds another repo to the project from its chip", () => {
    const { onAddRepo } = renderPanel();

    fireEvent.click(screen.getByTestId("workbench-repo-chip-cli"));

    expect(onAddRepo).toHaveBeenCalledWith(
      expect.objectContaining({ id: "cli" }),
    );
  });
});
