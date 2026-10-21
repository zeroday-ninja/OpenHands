import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentCanvasControlStatus } from "#/api/agent-canvas-updates";
import { useAgentCanvasSelfUpdate } from "#/hooks/use-agent-canvas-self-update";

const { requestMock, statusMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  statusMock: vi.fn(),
}));

vi.mock("#/api/agent-canvas-updates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#/api/agent-canvas-updates")>()),
  requestAgentCanvasControl: requestMock,
  fetchAgentCanvasControlStatus: statusMock,
}));

const control = {
  info: {
    instance: "old",
    enabled: true,
    version: "1.0.0",
    self_update: {
      supported: true,
      method: "git-checkout" as const,
      reason: null,
    },
    restart: { supported: true, reason: null },
    status_path: "/__agent-canvas/status",
    update_path: "/__agent-canvas/update",
    restart_path: "/__agent-canvas/restart",
  },
  target: { host: "", apiKey: "key" },
};

function status(
  overrides: Partial<AgentCanvasControlStatus>,
): AgentCanvasControlStatus {
  return {
    instance: "old",
    enabled: true,
    phase: "updating",
    message: null,
    updated_at: "now",
    ...overrides,
  };
}

beforeEach(() => {
  requestMock.mockResolvedValue(status({ phase: "updating" }));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useAgentCanvasSelfUpdate", () => {
  it("reloads the page once a different stack instance answers the status route", async () => {
    // The old stack reports progress, goes away while restarting, then the
    // replacement answers with a new instance id.
    statusMock
      .mockResolvedValueOnce(status({ phase: "updating", message: "git pull" }))
      .mockResolvedValueOnce(status({ phase: "restarting" }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(status({ instance: "new", phase: "idle" }));
    const reload = vi.fn();
    const { result } = renderHook(() =>
      useAgentCanvasSelfUpdate(control, {
        reload,
        pollMs: 5,
        targetVersion: "2.0.0",
      }),
    );

    await act(async () => {
      await result.current.start("update");
    });

    expect(requestMock).toHaveBeenCalledWith(
      control.target,
      "update",
      expect.any(AbortSignal),
      { targetVersion: "2.0.0" },
    );
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(result.current.state).toEqual({
      phase: "reloading",
      action: "update",
    });
  });

  it("reloads when the replacement stack answers without control routes", async () => {
    // A real newer release may run a launcher without these routes: once
    // the old stack went down, any stack that answers is the new one.
    const { AgentCanvasControlError } =
      await import("#/api/agent-canvas-updates");
    statusMock
      .mockResolvedValueOnce(status({ phase: "restarting" }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(
        new AgentCanvasControlError(
          200,
          "The stack has no control routes.",
          true,
        ),
      );
    const reload = vi.fn();
    const { result } = renderHook(() =>
      useAgentCanvasSelfUpdate(control, { reload, pollMs: 5 }),
    );

    await act(async () => {
      await result.current.start("update");
    });

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(result.current.state).toEqual({
      phase: "reloading",
      action: "update",
    });
  });

  it("does not reload on a stack without control routes before the old one went down", async () => {
    const { AgentCanvasControlError } =
      await import("#/api/agent-canvas-updates");
    statusMock
      .mockRejectedValueOnce(
        new AgentCanvasControlError(
          200,
          "The stack has no control routes.",
          true,
        ),
      )
      .mockResolvedValueOnce(status({ instance: "new", phase: "idle" }));
    const reload = vi.fn();
    const { result } = renderHook(() =>
      useAgentCanvasSelfUpdate(control, { reload, pollMs: 5 }),
    );

    await act(async () => {
      await result.current.start("update");
    });

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    // The first (no-control) answer only marked the stack as going down.
    expect(statusMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces the launcher's failure message and stops polling", async () => {
    statusMock.mockResolvedValue(
      status({ phase: "failed", message: "git pull failed (exit 128)" }),
    );
    const reload = vi.fn();
    const { result } = renderHook(() =>
      useAgentCanvasSelfUpdate(control, { reload, pollMs: 5 }),
    );

    await act(async () => {
      await result.current.start("update");
    });

    await waitFor(() =>
      expect(result.current.state).toEqual({
        phase: "failed",
        action: "update",
        error: "git pull failed (exit 128)",
      }),
    );
    expect(reload).not.toHaveBeenCalled();
    const polls = statusMock.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(statusMock.mock.calls.length).toBe(polls);
  });

  it("fails without polling when the request itself is refused", async () => {
    requestMock.mockRejectedValue(new Error("unauthorized"));
    const { result } = renderHook(() =>
      useAgentCanvasSelfUpdate(control, { reload: vi.fn(), pollMs: 5 }),
    );

    await act(async () => {
      await result.current.start("restart");
    });

    expect(result.current.state).toEqual({
      phase: "failed",
      action: "restart",
      error: "unauthorized",
    });
    expect(statusMock).not.toHaveBeenCalled();
  });

  it("does nothing without a control target", async () => {
    const { result } = renderHook(() =>
      useAgentCanvasSelfUpdate(null, { reload: vi.fn(), pollMs: 5 }),
    );
    await act(async () => {
      await result.current.start("update");
    });
    expect(requestMock).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({ phase: "idle" });
  });
});
