import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AutomationService from "#/api/automation-service/automation-service.api";
import {
  __resetActiveStoreForTests,
  setActiveSelection,
  setRegisteredBackends,
} from "#/api/backend-registry/active-store";
import { __resetHealthStoreForTests } from "#/api/backend-registry/health-store";
import {
  BACKEND_HEALTH_STORAGE_KEY,
  MAX_CONSECUTIVE_FAILURES,
} from "#/api/backend-registry/health-storage";
import type { Backend } from "#/api/backend-registry/types";
import { ActiveBackendProvider } from "#/contexts/active-backend-context";
import { useWorkGraph } from "#/hooks/query/use-work-graph";
import type { WorkGraphResponse } from "#/types/work-graph";

vi.mock("#/api/automation-service/automation-service.api", () => ({
  default: { getWorkGraph: vi.fn() },
}));

// Mirrors the in-flight poll window in `use-work-graph.ts`. Declared here so a
// change to that cadence has to be made deliberately in both places.
const POLL_INTERVAL_MS = 5000;

const workstation: Backend = {
  id: "local-workstation",
  name: "Workstation",
  host: "http://localhost:8000",
  apiKey: "session-key",
  kind: "local",
};

const laptop: Backend = {
  id: "local-laptop",
  name: "Laptop",
  host: "http://laptop.example.com",
  apiKey: "session-key",
  kind: "local",
};

function response(
  overrides: Partial<WorkGraphResponse> = {},
): WorkGraphResponse {
  return {
    schema_version: 1,
    service_id: "service",
    org_id: null,
    generated_at: "2026-10-24T08:00:00Z",
    cursor: "cursor-1",
    has_more: false,
    in_flight: 0,
    nodes: [],
    edges: [],
    ...overrides,
  };
}

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ActiveBackendProvider>{children}</ActiveBackendProvider>
      </QueryClientProvider>
    );
  };
}

beforeEach(() => {
  window.localStorage.clear();
  __resetActiveStoreForTests();
  __resetHealthStoreForTests();
  vi.mocked(AutomationService.getWorkGraph).mockReset();
  setRegisteredBackends([workstation]);
  setActiveSelection({ backendId: workstation.id });
});

afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
  __resetActiveStoreForTests();
  __resetHealthStoreForTests();
});

describe("useWorkGraph", () => {
  it("never asks a backend the health circuit breaker gave up on, but still shows it as unreachable", async () => {
    // Arrange: the breaker has already given up on the laptop, and recorded
    // why. Polling it again is exactly what the breaker exists to prevent.
    setRegisteredBackends([workstation, laptop]);
    window.localStorage.setItem(
      BACKEND_HEALTH_STORAGE_KEY,
      JSON.stringify({
        [laptop.id]: {
          consecutiveFailures: MAX_CONSECUTIVE_FAILURES,
          lastError: "ECONNREFUSED",
          lastFailureAt: Date.now(),
          disabled: true,
        },
      }),
    );
    __resetHealthStoreForTests();
    vi.mocked(AutomationService.getWorkGraph).mockResolvedValue(response());

    // Act
    const { result } = renderHook(() => useWorkGraph(), {
      wrapper: makeWrapper(),
    });

    // Assert: asked once, of the reachable deployment only…
    await waitFor(() =>
      expect(AutomationService.getWorkGraph).toHaveBeenCalledTimes(1),
    );
    expect(AutomationService.getWorkGraph).toHaveBeenCalledWith(
      expect.objectContaining({ id: workstation.id }),
      null,
      expect.anything(),
    );

    // …and the one it never asked is in the graph anyway, named and explained.
    // A deployment missing from the picture would read as a deployment with
    // nothing to do.
    await waitFor(() =>
      expect(result.current.graph.nodes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: "oh:1/local:laptop.example.com/backend:self",
            kind: "backend",
            label: "Laptop",
            status: "unreachable",
          }),
        ]),
      ),
    );
    expect(result.current.graph.omissions).toEqual([
      {
        kind: "backend_unreachable",
        backendKey: "local:laptop.example.com",
        key: "oh:1/local:laptop.example.com/backend:self",
        detail: "ECONNREFUSED",
      },
    ]);
  });

  it("asks again every five seconds while work is in flight, and stops entirely once none is", async () => {
    // Arrange: the first answer has work running, the next does not.
    vi.mocked(AutomationService.getWorkGraph)
      .mockResolvedValueOnce(response({ in_flight: 2 }))
      .mockResolvedValue(response({ in_flight: 0 }));

    // Fake timers because the contract is a cadence: one request per window
    // while something is running, and none at all afterwards.
    vi.useFakeTimers();

    // Act
    renderHook(() => useWorkGraph(), { wrapper: makeWrapper() });

    // Assert
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(AutomationService.getWorkGraph).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    expect(AutomationService.getWorkGraph).toHaveBeenCalledTimes(2);

    // Nothing is in flight now, so several further windows cost no requests.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 4);
    });
    expect(AutomationService.getWorkGraph).toHaveBeenCalledTimes(2);
  });

  it("keeps asking an idle deployment while another one is working", async () => {
    // Arrange: only the workstation has work. The laptop is where that work's
    // next cycle could appear, and its own answer can never say so.
    setRegisteredBackends([workstation, laptop]);
    vi.mocked(AutomationService.getWorkGraph).mockImplementation(
      (backend: Backend) =>
        Promise.resolve(
          response({ in_flight: backend.id === workstation.id ? 1 : 0 }),
        ),
    );
    vi.useFakeTimers();

    // Act
    renderHook(() => useWorkGraph(), { wrapper: makeWrapper() });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });

    // Assert
    const asked = (backend: Backend) =>
      vi
        .mocked(AutomationService.getWorkGraph)
        .mock.calls.filter((call) => call[0].id === backend.id).length;
    expect(asked(workstation)).toBe(2);
    expect(asked(laptop)).toBe(2);
  });
});
