import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentCanvasVersionModal } from "#/components/features/settings/agent-canvas-version-modal";

const { controlQueryMock, requestMock, statusMock } = vi.hoisted(() => ({
  controlQueryMock: vi.fn(),
  requestMock: vi.fn(),
  statusMock: vi.fn(),
}));

vi.mock("#/hooks/query/use-agent-canvas-control", () => ({
  useAgentCanvasControl: () => controlQueryMock(),
}));

vi.mock("#/api/agent-canvas-updates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#/api/agent-canvas-updates")>()),
  requestAgentCanvasControl: requestMock,
  fetchAgentCanvasControlStatus: statusMock,
}));

const localControl = {
  info: {
    instance: "old",
    enabled: true,
    version: "1.0.0",
    self_update: { supported: true, method: "npm-global", reason: null },
    restart: { supported: true, reason: null },
    status_path: "/__agent-canvas/status",
    update_path: "/__agent-canvas/update",
    restart_path: "/__agent-canvas/restart",
  },
  target: { host: "", apiKey: "key" },
};

function renderModal(updateAvailable = true) {
  return render(
    <AgentCanvasVersionModal
      installedVersion="1.0.0"
      latestVersion={updateAvailable ? "2.0.0" : "1.0.0"}
      updateAvailable={updateAvailable}
      isChecking={false}
      onCheckForUpdates={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

beforeEach(() => {
  controlQueryMock.mockReturnValue({ data: null });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("AgentCanvasVersionModal", () => {
  it("lists the update commands when the stack cannot update itself", () => {
    renderModal();

    expect(
      screen.queryByTestId("agent-canvas-self-update-button"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("agent-canvas-update-commands")).toHaveAttribute(
      "open",
    );
    expect(
      screen.getByText("SETTINGS$VERSION_UPDATE_MESSAGE"),
    ).toBeInTheDocument();
  });

  it("offers a one-click update on a local launcher and tucks the commands away", () => {
    controlQueryMock.mockReturnValue({ data: localControl });

    renderModal();

    expect(screen.getByTestId("agent-canvas-self-update-button")).toBeEnabled();
    expect(screen.getByTestId("agent-canvas-restart-button")).toBeEnabled();
    expect(
      screen.getByText("SETTINGS$VERSION_UPDATE_METHOD_NPM"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("SETTINGS$VERSION_UPDATE_MESSAGE_SELF"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("agent-canvas-update-commands"),
    ).not.toHaveAttribute("open");
    expect(
      screen.getByText("SETTINGS$VERSION_UPDATE_MANUAL"),
    ).toBeInTheDocument();
  });

  it("runs the update, shows progress, and reports a launcher failure", async () => {
    controlQueryMock.mockReturnValue({ data: localControl });
    requestMock.mockResolvedValue({
      instance: "old",
      enabled: true,
      phase: "updating",
      message: null,
      updated_at: "now",
    });
    statusMock.mockResolvedValue({
      instance: "old",
      enabled: true,
      phase: "failed",
      message: "npm install -g failed (exit 1)",
      updated_at: "now",
    });

    renderModal();
    fireEvent.click(screen.getByTestId("agent-canvas-self-update-button"));

    expect(requestMock).toHaveBeenCalledWith(
      localControl.target,
      "update",
      expect.any(AbortSignal),
    );
    expect(
      await screen.findByTestId("agent-canvas-self-update-status"),
    ).toHaveTextContent("SETTINGS$VERSION_UPDATE_PROGRESS_UPDATING");
    expect(
      screen.getByTestId("agent-canvas-self-update-button"),
    ).toBeDisabled();
    await waitFor(() =>
      expect(
        screen.getByTestId("agent-canvas-self-update-error"),
      ).toHaveTextContent("SETTINGS$VERSION_UPDATE_FAILED"),
    );
    expect(screen.getByTestId("agent-canvas-self-update-button")).toBeEnabled();
  });

  it("offers only a restart when the install is up to date", () => {
    controlQueryMock.mockReturnValue({ data: localControl });

    renderModal(false);

    expect(
      screen.queryByTestId("agent-canvas-self-update-button"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("agent-canvas-restart-button"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("agent-canvas-update-commands"),
    ).not.toBeInTheDocument();
  });
});
