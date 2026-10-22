import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import AutomationService from "#/api/automation-service/automation-service.api";
import {
  __resetActiveStoreForTests,
  setActiveSelection,
  setRegisteredBackends,
} from "#/api/backend-registry/active-store";
import { ActiveBackendProvider } from "#/contexts/active-backend-context";
import AutomationSetupRoute, {
  clientLoader,
} from "#/routes/automation-setup-route";
import type { Backend } from "#/api/backend-registry/types";
import type { Automation } from "#/types/automation";

vi.mock("#/api/automation-service/automation-service.api", () => ({
  default: { getAutomation: vi.fn() },
}));

// The route reads its id from the loader; the real router is not running the
// loader in these renders, so stub the data router's hook with it.
let loaderData: ReturnType<typeof clientLoader>;
vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return { ...actual, useLoaderData: () => loaderData };
});

const localBackend: Backend = {
  id: "local-1",
  name: "Local 1",
  host: "http://localhost:8000",
  apiKey: "session-key",
  kind: "local",
};

const AUTOMATION_ID = "0c2ac790-abdb-494a-b968-d1d0fc844170";

function buildAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: AUTOMATION_ID,
    name: "Dashboard skills and extensions",
    prompt: null,
    trigger: { type: "cron", schedule: "0 5 1 * *" },
    enabled: true,
    created_at: "2026-10-22T13:16:39Z",
    updated_at: "2026-10-22T20:51:34Z",
    ...overrides,
  };
}

function renderRoute(automationId = AUTOMATION_ID) {
  loaderData = { automationId, isCatalogEntry: false };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ActiveBackendProvider>
        <MemoryRouter initialEntries={[`/automations/new/${automationId}`]}>
          <Routes>
            <Route
              path="/automations/new/:automationId"
              element={<AutomationSetupRoute />}
            />
            <Route
              path="/automations/improve/:automationId"
              element={<div data-testid="improve-program-page" />}
            />
            <Route
              path="/automations/:automationId"
              element={<div data-testid="automation-detail-page" />}
            />
          </Routes>
        </MemoryRouter>
      </ActiveBackendProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  __resetActiveStoreForTests();
  setRegisteredBackends([localBackend]);
  setActiveSelection({ backendId: localBackend.id });
});

afterEach(() => {
  vi.clearAllMocks();
  __resetActiveStoreForTests();
  window.localStorage.clear();
});

describe("the setup route with an id the catalog does not claim", () => {
  it("admits the id instead of 404ing the route", () => {
    // Arrange / Act — an existing automation's id, which no catalog entry has.
    const data = clientLoader({
      params: { automationId: AUTOMATION_ID },
    } as Parameters<typeof clientLoader>[0]);

    // Assert
    expect(data).toEqual({
      automationId: AUTOMATION_ID,
      isCatalogEntry: false,
    });
  });

  it("sends an improvement program's id to the page that configures it", async () => {
    // Arrange
    vi.mocked(AutomationService.getAutomation).mockResolvedValue(
      buildAutomation({
        preset_metadata: {
          preset_type: "improve",
          improve: { branch_prefix: "improve/" },
        },
      }),
    );

    // Act
    renderRoute();

    // Assert
    expect(await screen.findByTestId("improve-program-page")).toBeVisible();
  });

  it("sends any other existing automation's id to its detail page", async () => {
    // Arrange
    vi.mocked(AutomationService.getAutomation).mockResolvedValue(
      buildAutomation(),
    );

    // Act
    renderRoute();

    // Assert
    expect(await screen.findByTestId("automation-detail-page")).toBeVisible();
  });

  it("reports an id that is no automation either as not found", async () => {
    // Arrange
    vi.mocked(AutomationService.getAutomation).mockRejectedValue(
      Object.assign(new Error("Not Found"), { status: 404 }),
    );

    // Act
    renderRoute("not-an-automation");

    // Assert — the route still renders the automation surface rather than
    // throwing the whole page away.
    expect(
      await screen.findByText("AUTOMATIONS$DETAIL$NOT_FOUND_TITLE"),
    ).toBeInTheDocument();
  });
});
