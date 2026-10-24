import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import SoulService from "#/api/soul-service/soul-service.api";
import type {
  IdentityDocumentResponse,
  SoulResponse,
} from "#/api/soul-service/soul.types";
import {
  __resetActiveStoreForTests,
  setActiveSelection,
  setRegisteredBackends,
} from "#/api/backend-registry/active-store";
import type { Backend } from "#/api/backend-registry/types";
import { ActiveBackendProvider } from "#/contexts/active-backend-context";
import { useSaveIdentityDocument } from "#/hooks/mutation/use-save-identity-document";
import { useSoul } from "#/hooks/query/use-soul";

vi.mock("#/api/soul-service/soul-service.api", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("#/api/soul-service/soul-service.api")
    >();
  return {
    ...actual,
    default: { getSoul: vi.fn(), saveIdentityDocument: vi.fn() },
  };
});

const localBackend: Backend = {
  id: "local-1",
  name: "Local 1",
  host: "http://localhost:8000",
  apiKey: "session-key",
  kind: "local",
};

const soul: SoulResponse = {
  content: "# Soul\n\nAsk first.\n",
  exists: true,
  path: "/home/leander/.openhands/soul/SOUL.md",
  size_bytes: 20,
};

function savedDocument(name: string): IdentityDocumentResponse {
  return {
    name,
    relative_path: name === "soul" ? "SOUL.md" : "STYLE.md",
    purpose: "What belongs in this document.",
    content: "Written.\n",
    exists: true,
    path: `/home/leander/.openhands/soul/${name}`,
    size_bytes: 9,
  };
}

/**
 * Both views of the user's identity at once: the document set this mutation
 * writes, and the single-file `/api/soul` view the improvement-program
 * suggestions read and append to.
 */
function renderBothViews() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return renderHook(
    () => ({ soul: useSoul(), save: useSaveIdentityDocument() }),
    {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>
          <ActiveBackendProvider>{children}</ActiveBackendProvider>
        </QueryClientProvider>
      ),
    },
  );
}

beforeEach(() => {
  window.localStorage.clear();
  __resetActiveStoreForTests();
  vi.mocked(SoulService.getSoul).mockResolvedValue(soul);
  setRegisteredBackends([localBackend]);
  setActiveSelection({ backendId: localBackend.id });
});

afterEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  __resetActiveStoreForTests();
});

/** The soul query settled, so a later read is a refetch rather than the first. */
async function renderWithSettledSoul() {
  const rendered = renderBothViews();
  await waitFor(() => expect(rendered.result.current.soul.data).toEqual(soul));
  expect(SoulService.getSoul).toHaveBeenCalledTimes(1);
  return rendered;
}

describe("useSaveIdentityDocument", () => {
  it("re-reads SOUL.md on its own route after writing it as a document", async () => {
    vi.mocked(SoulService.saveIdentityDocument).mockResolvedValue(
      savedDocument("soul"),
    );
    const { result } = await renderWithSettledSoul();

    await act(async () => {
      await result.current.save.mutateAsync({ name: "soul", content: "next" });
    });

    // Both routes serve the same file, so the single-file view would
    // otherwise keep answering with the text this save replaced.
    await waitFor(() => expect(SoulService.getSoul).toHaveBeenCalledTimes(2));
  });

  it("leaves SOUL.md alone when a different document is written", async () => {
    vi.mocked(SoulService.saveIdentityDocument).mockResolvedValue(
      savedDocument("style"),
    );
    const { result } = await renderWithSettledSoul();

    await act(async () => {
      await result.current.save.mutateAsync({ name: "style", content: "next" });
    });

    expect(SoulService.getSoul).toHaveBeenCalledTimes(1);
  });
});
