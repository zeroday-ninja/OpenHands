import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetActiveStoreForTests,
  setActiveSelection,
  setRegisteredBackends,
} from "#/api/backend-registry/active-store";
import type { Backend } from "#/api/backend-registry/types";
import { ActiveBackendProvider } from "#/contexts/active-backend-context";
import { MemorySyncAction } from "#/components/features/settings/soul/memory-sync-action";
import { useSyncMemoryAcrossBackends } from "#/hooks/mutation/use-sync-memory-across-backends";

/**
 * What a sync tells you when two machines disagree.
 *
 * MEMORY.md is append-only, so folding two copies together is a union and
 * almost never a conflict. The exception is one id arriving with two bodies,
 * which means something edited history — and the rule the milestone sets is
 * that both are kept and the user is told, never that one is quietly chosen.
 *
 * Until now the conflict branch had no test at all: every case asserted
 * `conflicts: []`. A surface nobody renders in a test is a surface that can
 * stop rendering without anybody noticing, which for this one means a lost
 * edit nobody is told about.
 */
vi.mock("#/hooks/mutation/use-sync-memory-across-backends", () => ({
  useSyncMemoryAcrossBackends: vi.fn(),
}));

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

function syncing(result: unknown) {
  vi.mocked(useSyncMemoryAcrossBackends).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    data: result,
  } as unknown as ReturnType<typeof useSyncMemoryAcrossBackends>);
}

function renderAction() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ActiveBackendProvider>
        <MemorySyncAction />
      </ActiveBackendProvider>
    </QueryClientProvider>,
  );
}

const synced = (conflicts: string[]) => ({
  backends: [
    {
      backendId: "laptop",
      backendName: "Laptop",
      added: 2,
      entryCount: 9,
      conflicts,
    },
    {
      backendId: "desktop",
      backendName: "Desktop",
      added: 1,
      entryCount: 9,
      conflicts,
    },
  ],
  skipped: [],
});

describe("what a memory sync reports", () => {
  beforeEach(() => {
    __resetActiveStoreForTests();
    setRegisteredBackends([laptop, desktop]);
    setActiveSelection({ backendId: laptop.id });
  });

  afterEach(() => {
    vi.clearAllMocks();
    __resetActiveStoreForTests();
  });

  it("names the entries that arrived in two versions", async () => {
    // "Open MEMORY.md to reconcile them" is an instruction to search a file
    // that may be months long. The ids are what to search for.
    syncing(synced(["mem-a1b2c3", "mem-d4e5f6"]));

    renderAction();

    const line = await screen.findByTestId("memory-sync-conflicts");
    expect(
      within(line).getByTestId("memory-sync-conflict-ids"),
    ).toHaveTextContent("mem-a1b2c3, mem-d4e5f6");
  });

  it("counts one entry once however many backends disagreed over it", async () => {
    // The same entry conflicting on three machines is one entry to go and
    // look at; listing it three times reads as three problems.
    syncing(synced(["mem-a1b2c3"]));

    renderAction();

    expect(
      await screen.findByTestId("memory-sync-conflict-ids"),
    ).toHaveTextContent(/^mem-a1b2c3$/);
  });

  it("summarises the tail rather than burying what did sync", async () => {
    // A sync that went badly must not push the lines saying what worked off
    // the top of the panel.
    syncing(
      synced(
        ["m1", "m2", "m3", "m4", "m5", "m6", "m7"].map((id) => `mem-${id}`),
      ),
    );

    renderAction();

    const ids = await screen.findByTestId("memory-sync-conflict-ids");
    expect(ids).toHaveTextContent("mem-m5");
    expect(ids).toHaveTextContent("+2");
    expect(ids).not.toHaveTextContent("mem-m6");
  });

  it("says nothing about conflicts when the merge was a clean union", async () => {
    // Which is almost always: the log is append-only, so two copies fold
    // together without anything to decide.
    syncing(synced([]));

    renderAction();

    await screen.findByTestId("memory-sync-result");
    expect(
      screen.queryByTestId("memory-sync-conflicts"),
    ).not.toBeInTheDocument();
  });
});
