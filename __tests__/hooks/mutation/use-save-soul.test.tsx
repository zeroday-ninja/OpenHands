import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import SoulService from "#/api/soul-service/soul-service.api";
import type {
  IdentitySetResponse,
  SoulResponse,
} from "#/api/soul-service/soul.types";
import {
  __resetActiveStoreForTests,
  setActiveSelection,
  setRegisteredBackends,
} from "#/api/backend-registry/active-store";
import type { Backend } from "#/api/backend-registry/types";
import { ActiveBackendProvider } from "#/contexts/active-backend-context";
import { useSaveSoul } from "#/hooks/mutation/use-save-soul";
import { useIdentityDocuments } from "#/hooks/query/use-identity-documents";

vi.mock("#/api/soul-service/soul-service.api", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("#/api/soul-service/soul-service.api")
    >();
  return {
    ...actual,
    default: { saveSoul: vi.fn(), getIdentityDocuments: vi.fn() },
  };
});

const localBackend: Backend = {
  id: "local-1",
  name: "Local 1",
  host: "http://localhost:8000",
  apiKey: "session-key",
  kind: "local",
};

const identitySet: IdentitySetResponse = {
  documents: [
    {
      name: "soul",
      relative_path: "SOUL.md",
      purpose: "Who you are.",
      content: "# Soul\n\nAsk first.\n",
      exists: true,
      path: "/home/leander/.openhands/soul/SOUL.md",
      size_bytes: 20,
    },
  ],
  directory: "/home/leander/.openhands/soul",
};

const savedSoul: SoulResponse = {
  content: "# Soul\n\nAsk first. Never force-push.\n",
  exists: true,
  path: identitySet.documents[0].path,
  size_bytes: 37,
};

describe("useSaveSoul", () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetActiveStoreForTests();
    vi.mocked(SoulService.getIdentityDocuments).mockResolvedValue(identitySet);
    vi.mocked(SoulService.saveSoul).mockResolvedValue(savedSoul);
    setRegisteredBackends([localBackend]);
    setActiveSelection({ backendId: localBackend.id });
  });

  afterEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    __resetActiveStoreForTests();
  });

  it("re-reads the document set after SOUL.md is written on its own route", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const { result } = renderHook(
      () => ({ documents: useIdentityDocuments(), save: useSaveSoul() }),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>
            <ActiveBackendProvider>{children}</ActiveBackendProvider>
          </QueryClientProvider>
        ),
      },
    );
    await waitFor(() =>
      expect(result.current.documents.data).toEqual(identitySet),
    );

    await act(async () => {
      await result.current.save.mutateAsync(savedSoul.content);
    });

    // SOUL.md is the set's first document: a write here that left the set
    // cached would let the settings page save over the text just appended.
    await waitFor(() =>
      expect(SoulService.getIdentityDocuments).toHaveBeenCalledTimes(2),
    );
  });
});
