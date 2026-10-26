import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  setActiveSelection,
  setRegisteredBackends,
} from "#/api/backend-registry/active-store";
import type { Backend } from "#/api/backend-registry/types";
import WorkspacesService from "#/api/workspaces-service/workspaces-service.api";
import { useResolvedWorkspaces } from "#/hooks/query/use-resolved-workspaces";
import { server } from "#/mocks/node";

const backend: Backend = {
  id: "local-test",
  name: "Local test backend",
  host: "http://localhost:3000",
  apiKey: "test-session-key",
  kind: "local",
};

const REPOS = { id: "/home/me/repos", name: "repos", path: "/home/me/repos" };

/** Answers the folder probes: the user's parent has children, `/projects` is absent. */
function serveFolders(options: { reposFail?: boolean } = {}) {
  server.use(
    http.get(`${backend.host}/api/file/search_subdirs`, ({ request }) => {
      const path = new URL(request.url).searchParams.get("path");
      if (path === REPOS.path && !options.reposFail) {
        return HttpResponse.json({
          items: [{ name: "hazard", path: `${REPOS.path}/hazard` }],
          next_page_id: null,
        });
      }
      return HttpResponse.json({ detail: "Not found" }, { status: 404 });
    }),
  );
}

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {children}
    </QueryClientProvider>
  );
}

describe("useResolvedWorkspaces", () => {
  beforeEach(() => {
    setRegisteredBackends([backend]);
    setActiveSelection({ backendId: backend.id });
    vi.spyOn(WorkspacesService, "listWorkspaces").mockResolvedValue({
      workspaces: [],
      workspaceParents: [REPOS],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setActiveSelection(null);
    setRegisteredBackends([]);
  });

  it("does not report the missing implicit parent as a failure of the user's folders", async () => {
    // Arrange: `/projects` does not exist on this host; the user's parent does.
    serveFolders();

    // Act
    const { result } = renderHook(() => useResolvedWorkspaces(), { wrapper });

    // Assert: the children are listed and nothing is said to have failed.
    await waitFor(() =>
      expect(result.current.workspaces.map((w) => w.name)).toEqual(["hazard"]),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isError).toBe(false);
  });

  it("still reports a parent the user added that cannot be read", async () => {
    // Arrange
    serveFolders({ reposFail: true });

    // Act
    const { result } = renderHook(() => useResolvedWorkspaces(), { wrapper });

    // Assert
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.workspaces).toEqual([]);
  });
});
