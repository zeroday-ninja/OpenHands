/**
 * A correction given on one machine reaching the others.
 *
 * The plan asks for memory "synced across backends, eventually consistent",
 * and the only thing that synced it was a button in soul settings — so a
 * correction filed on the laptop reached the desktop when somebody remembered
 * to press it. A button is not an interval.
 *
 * Fired here, at the moment memory actually changed, rather than on a timer
 * or at startup: nothing is sent from a machine nobody has corrected anything
 * on, and no host embedding Canvas as a library starts syncing on mount.
 */

import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { server } from "../../../src/mocks/node";
import {
  __resetActiveStoreForTests,
  setActiveSelection,
  setRegisteredBackends,
} from "#/api/backend-registry/active-store";
import { ActiveBackendProvider } from "#/contexts/active-backend-context";
import type { Backend } from "#/api/backend-registry/types";
import { useCaptureFeatureFeedback } from "#/hooks/mutation/use-capture-feature-feedback";
import type { FeatureTrial } from "#/types/feature-trial";

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

const TRIAL: FeatureTrial = {
  id: "map-waiting-on-you",
  kind: "panel",
  shippedOn: "2026-10-24",
  titleKey: "FEATURE$WAITING$TITLE",
  summaryKey: "FEATURE$WAITING$SUMMARY",
  route: "/map",
  steps: [{ titleKey: "FEATURE$WAITING$STEP1_TITLE", bodyKey: "x" }],
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

/** Every host a merge was posted to, in arrival order. */
function watchMerges(): string[] {
  const merged: string[] = [];
  server.use(
    http.post("*/api/automation/v1/lessons", () =>
      HttpResponse.json(
        { lesson: { id: "lesson-9" }, repeat: false },
        { status: 201 },
      ),
    ),
    http.get("*/api/soul/documents/memory", () =>
      HttpResponse.json({
        name: "memory",
        content: "",
        exists: false,
        size_bytes: 0,
      }),
    ),
    http.post("*/api/soul/documents/memory/merge", ({ request }) => {
      merged.push(new URL(request.url).host);
      return HttpResponse.json({ added: 1, entry_count: 1, conflicts: [] });
    }),
  );
  return merged;
}

describe("filing a correction", () => {
  beforeEach(() => __resetActiveStoreForTests());
  afterEach(() => __resetActiveStoreForTests());

  it("carries it to the other machine without anybody pressing sync", async () => {
    setRegisteredBackends([laptop, desktop]);
    setActiveSelection({ backendId: laptop.id });
    const merged = watchMerges();

    const { result } = renderHook(() => useCaptureFeatureFeedback(), {
      wrapper,
    });
    result.current.mutate({ trial: TRIAL, rating: "down", comment: null });

    // The filing goes to the active backend, and the sync that follows gives
    // every eligible machine the union — including the one nobody is looking
    // at.
    await waitFor(() => expect(merged).toContain("10.0.0.5:8000"));
  });

  it("does not sync a single machine with itself", async () => {
    setRegisteredBackends([laptop]);
    setActiveSelection({ backendId: laptop.id });
    const merged = watchMerges();

    const { result } = renderHook(() => useCaptureFeatureFeedback(), {
      wrapper,
    });
    result.current.mutate({ trial: TRIAL, rating: "up", comment: null });

    // The correction is still filed — that is the first merge — and no second
    // round of traffic follows it.
    await waitFor(() => expect(merged.length).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(merged).toEqual(["localhost:8000"]);
  });
});
