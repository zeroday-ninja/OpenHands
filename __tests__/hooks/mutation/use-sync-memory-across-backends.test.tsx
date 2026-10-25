import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SoulService from "#/api/soul-service/soul-service.api";
import {
  __resetActiveStoreForTests,
  setActiveSelection,
  setRegisteredBackends,
} from "#/api/backend-registry/active-store";
import { ActiveBackendProvider } from "#/contexts/active-backend-context";
import type { Backend } from "#/api/backend-registry/types";
import { useSyncMemoryAcrossBackends } from "#/hooks/mutation/use-sync-memory-across-backends";

vi.mock("#/api/soul-service/soul-service.api", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("#/api/soul-service/soul-service.api")
    >();
  return {
    ...actual,
    default: {
      ...actual.default,
      getIdentityDocumentFrom: vi.fn(),
      mergeMemoryInto: vi.fn(),
    },
  };
});

const laptop: Backend = {
  id: "laptop",
  name: "Laptop",
  host: "http://localhost:8000",
  apiKey: "key-a",
  kind: "local",
};
const desktop: Backend = {
  id: "desktop",
  name: "Desktop",
  host: "http://10.0.0.5:8000",
  apiKey: "key-b",
  kind: "local",
};
const cloud: Backend = {
  id: "cloud",
  name: "Cloud",
  host: "https://app.all-hands.dev",
  apiKey: "",
  kind: "cloud",
};

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <ActiveBackendProvider>{children}</ActiveBackendProvider>
    </QueryClientProvider>
  );
}

describe("useSyncMemoryAcrossBackends", () => {
  beforeEach(() => {
    __resetActiveStoreForTests();
    setRegisteredBackends([laptop, desktop, cloud]);
    setActiveSelection({ backendId: laptop.id });
  });

  afterEach(() => {
    vi.clearAllMocks();
    __resetActiveStoreForTests();
  });

  it("gives every backend the union of what they all know", async () => {
    // Arrange: each machine has learned something the other has not.
    vi.mocked(SoulService.getIdentityDocumentFrom).mockImplementation(
      async (backend) => ({
        name: "memory",
        relative_path: "MEMORY.md",
        purpose: "",
        content:
          backend.id === "laptop"
            ? "## A\n<!-- id: a -->"
            : "## B\n<!-- id: b -->",
        exists: true,
        path: "/x/MEMORY.md",
        size_bytes: 10,
      }),
    );
    vi.mocked(SoulService.mergeMemoryInto).mockResolvedValue({
      content: "merged",
      entry_count: 2,
      added: 1,
      conflicts: [],
    });

    // Act
    const { result } = renderHook(() => useSyncMemoryAcrossBackends(), {
      wrapper,
    });
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Assert: both logs reach both machines, which is what makes the result
    // the same whichever order the requests finished in.
    const calls = vi.mocked(SoulService.mergeMemoryInto).mock.calls;
    expect(calls).toHaveLength(2);
    for (const [, logs] of calls) {
      expect(logs).toHaveLength(2);
    }
    expect(result.current.data?.backends).toHaveLength(2);
  });

  it("says which backends were left out rather than skipping them quietly", async () => {
    // Arrange: one machine is unreachable, and a cloud backend has no such
    // file at all.
    vi.mocked(SoulService.getIdentityDocumentFrom).mockImplementation(
      async (backend) => {
        if (backend.id === "desktop") throw new Error("connect ECONNREFUSED");
        return {
          name: "memory",
          relative_path: "MEMORY.md",
          purpose: "",
          content: "## A\n<!-- id: a -->",
          exists: true,
          path: "/x/MEMORY.md",
          size_bytes: 10,
        };
      },
    );
    vi.mocked(SoulService.mergeMemoryInto).mockResolvedValue({
      content: "merged",
      entry_count: 1,
      added: 0,
      conflicts: [],
    });

    // Act
    const { result } = renderHook(() => useSyncMemoryAcrossBackends(), {
      wrapper,
    });
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Assert: a sync that silently left a machine out would leave the user
    // believing their memory is somewhere it is not.
    const skipped = result.current.data?.skipped ?? [];
    expect(skipped.map((entry) => entry.backendId).sort()).toEqual([
      "cloud",
      "desktop",
    ]);
    expect(result.current.data?.backends).toHaveLength(1);
  });
});
