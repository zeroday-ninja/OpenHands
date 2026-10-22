import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";

import { I18nKey } from "#/i18n/declaration";
import AutomationService from "#/api/automation-service/automation-service.api";
import {
  __resetActiveStoreForTests,
  setActiveSelection,
  setRegisteredBackends,
} from "#/api/backend-registry/active-store";
import { ActiveBackendProvider } from "#/contexts/active-backend-context";
import AutomationImprove from "#/routes/automation-improve";
import type { Backend } from "#/api/backend-registry/types";
import type { Automation } from "#/types/automation";
import {
  ImproveCycleStatus,
  ImproveVerdict,
  type ImproveCycle,
  type ImproveCycleRepository,
  type ImproveProgramConfig,
  type ImproveRotationResponse,
} from "#/types/improve";

vi.mock("#/api/automation-service/automation-service.api", () => ({
  default: {
    checkHealth: vi.fn(),
    getAutomation: vi.fn(),
    getImproveRotation: vi.fn(),
    listImproveCycles: vi.fn(),
  },
}));

const localBackend: Backend = {
  id: "local-1",
  name: "Local 1",
  host: "http://localhost:8000",
  apiKey: "session-key",
  kind: "local",
};

const AUTOMATION_ID = "auto-improve-1";

const config: ImproveProgramConfig = {
  builder_profile_id: "profile-builder",
  reviewer_profile_ids: [],
  repository_source: "git_sync",
  repositories: [],
  repository_labels: [],
  branch_prefix: "improve/",
  max_changed_files: 20,
  open_pr: true,
  focus: null,
};

const hazard: ImproveCycleRepository = {
  label: "hazard",
  url: "https://github.com/zeroday-ninja/HAZARD",
  ref: "main",
  index: 0,
  remote_id: "remote-hazard",
};

const pairwatch: ImproveCycleRepository = {
  label: "pairwatch",
  url: "https://github.com/zeroday-ninja/pairwatch",
  ref: null,
  index: 1,
  remote_id: "remote-pairwatch",
};

const biomoe: ImproveCycleRepository = {
  label: "biomoe",
  url: "https://github.com/zeroday-ninja/biomoe",
  ref: null,
  index: 2,
  remote_id: "remote-biomoe",
};

const automation: Automation = {
  id: AUTOMATION_ID,
  name: "Rotating repository improvements",
  prompt: null,
  trigger: { type: "cron", schedule: "0 6 * * *" },
  enabled: true,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-22T00:00:00Z",
  preset_metadata: { preset_type: "improve", improve: config },
};

/** Reviewed by a runtime other than the one that built it. */
const reviewedCycle: ImproveCycle = {
  id: "cycle-1",
  automation_id: AUTOMATION_ID,
  run_id: "run-1",
  status: ImproveCycleStatus.COMPLETED,
  verdict: ImproveVerdict.CHANGES_REQUESTED,
  repository: hazard,
  builder_profile_id: config.builder_profile_id,
  builder_runtime: "claude-code",
  builder_conversation_id: "conv-builder-1",
  summary: "Replaced the polling loop with the run's own phase callback.",
  branch: "improve/phase-callback",
  pr_url: "https://github.com/zeroday-ninja/HAZARD/pull/7",
  sources: [
    {
      url: "https://docs.python.org/3/library/asyncio-task.html",
      title: "asyncio tasks",
      note: "Why the loop starved the callback.",
    },
  ],
  reviews: [
    {
      profile_id: "profile-reviewer",
      profile_name: "Codex reviewer",
      runtime: "codex",
      conversation_id: "conv-review-1",
      verdict: ImproveVerdict.CHANGES_REQUESTED,
      summary: "The callback can fire twice for one phase.",
      concerns: ["No test covers a repeated phase callback."],
      stale_sources: ["https://docs.python.org/3/library/asyncio-task.html"],
    },
  ],
  error: null,
  created_at: "2026-10-20T06:00:00Z",
  updated_at: "2026-10-20T07:00:00Z",
  completed_at: "2026-10-20T07:00:00Z",
};

/** Nobody else was available to review this one. */
const unreviewedCycle: ImproveCycle = {
  ...reviewedCycle,
  id: "cycle-2",
  run_id: "run-2",
  verdict: ImproveVerdict.SINGLE_RUNTIME,
  repository: pairwatch,
  builder_runtime: "codex",
  builder_conversation_id: "conv-builder-2",
  summary: "Added the missing aria-label to the icon-only trigger.",
  branch: "improve/trigger-label",
  pr_url: null,
  sources: [],
  reviews: [],
  created_at: "2026-10-21T06:00:00Z",
  updated_at: "2026-10-21T07:00:00Z",
  completed_at: "2026-10-21T07:00:00Z",
};

const rotation: ImproveRotationResponse = {
  repositories: [hazard, pairwatch, biomoe],
  // The newest cycle took index 1, so index 2 is what the next run takes.
  next_index: 2,
  last_cycle: unreviewedCycle,
  config,
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ActiveBackendProvider>
        <MemoryRouter
          initialEntries={[`/automations/improve/${AUTOMATION_ID}`]}
        >
          <Routes>
            <Route
              path="/automations/improve/:automationId"
              element={<AutomationImprove />}
            />
          </Routes>
        </MemoryRouter>
      </ActiveBackendProvider>
    </QueryClientProvider>,
  );
}

const cycleCards = () => screen.findAllByTestId("improve-cycle-card");

beforeEach(() => {
  window.localStorage.clear();
  __resetActiveStoreForTests();
  vi.mocked(AutomationService.checkHealth).mockResolvedValue({ status: "ok" });
  vi.mocked(AutomationService.getAutomation).mockResolvedValue(automation);
  vi.mocked(AutomationService.getImproveRotation).mockResolvedValue(rotation);
  vi.mocked(AutomationService.listImproveCycles).mockResolvedValue({
    cycles: [unreviewedCycle, reviewedCycle],
    total: 2,
  });
  setRegisteredBackends([localBackend]);
  setActiveSelection({ backendId: localBackend.id });
});

afterEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  __resetActiveStoreForTests();
});

describe("AutomationImprove rotation", () => {
  it("marks only the repository the next run will take, and shows each one's last verdict", async () => {
    renderPage();

    const entries = await screen.findAllByTestId("improve-rotation-entry");
    expect(entries.map((entry) => entry.dataset.upNext)).toEqual([
      "false",
      "false",
      "true",
    ]);
    expect(
      within(entries[2]).getByTestId("improve-rotation-up-next"),
    ).toBeInTheDocument();
    // Each repository carries the verdict its own last cycle reached.
    expect(
      within(entries[0]).getByTestId("improve-rotation-verdict-badge"),
    ).toHaveAttribute("data-verdict", ImproveVerdict.CHANGES_REQUESTED);
    expect(
      within(entries[1]).getByTestId("improve-rotation-verdict-badge"),
    ).toHaveAttribute("data-verdict", ImproveVerdict.SINGLE_RUNTIME);
    // Never worked on, so it claims no verdict at all.
    expect(
      within(entries[2]).queryByTestId("improve-rotation-last-verdict"),
    ).not.toBeInTheDocument();
  });

  it("sends the user to Git Sync when the rotation has nothing in it", async () => {
    vi.mocked(AutomationService.getImproveRotation).mockResolvedValue({
      ...rotation,
      repositories: [],
      next_index: null,
      last_cycle: null,
    });
    vi.mocked(AutomationService.listImproveCycles).mockResolvedValue({
      cycles: [],
      total: 0,
    });
    renderPage();

    const empty = await screen.findByTestId("improve-rotation-empty");
    expect(empty).toHaveTextContent(
      I18nKey.AUTOMATIONS$IMPROVE$ROTATION_EMPTY_BODY,
    );
    expect(
      within(empty).getByRole("link", {
        name: I18nKey.AUTOMATIONS$IMPROVE$ROTATION_EMPTY_LINK,
      }),
    ).toHaveAttribute("href", "/automations/git-sync");
    expect(
      screen.queryByTestId("improve-rotation-entry"),
    ).not.toBeInTheDocument();
  });

  it("says a program with no improvement configuration has none", async () => {
    vi.mocked(AutomationService.getImproveRotation).mockRejectedValue(
      Object.assign(new Error("Not an improvement program"), { status: 409 }),
    );
    renderPage();

    expect(
      await screen.findByTestId("improve-not-a-program"),
    ).toHaveTextContent(I18nKey.AUTOMATIONS$IMPROVE$NOT_A_PROGRAM_BODY);
    expect(screen.queryByTestId("improve-rotation")).not.toBeInTheDocument();
  });
});

describe("AutomationImprove cycle history", () => {
  it("shows the builder's work, its cited sources and the reviewer's own runtime", async () => {
    renderPage();

    const [, reviewed] = await cycleCards();
    expect(
      within(reviewed).getByTestId("improve-cycle-builder-runtime"),
    ).toHaveTextContent("claude-code");
    expect(
      within(reviewed).getByTestId("improve-cycle-verdict-badge"),
    ).toHaveAttribute("data-verdict", ImproveVerdict.CHANGES_REQUESTED);
    expect(
      within(reviewed).getByTestId("improve-cycle-summary"),
    ).toHaveTextContent(reviewedCycle.summary as string);
    expect(
      within(reviewed).getByTestId("improve-builder-conversation-link"),
    ).toHaveAttribute("href", "/conversations/conv-builder-1");
    expect(
      within(reviewed).getByTestId("improve-cycle-pr-link"),
    ).toHaveAttribute("href", reviewedCycle.pr_url as string);

    const source = within(reviewed).getByTestId("improve-cycle-source");
    expect(
      within(source).getByRole("link", { name: /asyncio tasks/ }),
    ).toHaveAttribute("href", reviewedCycle.sources[0].url);
    expect(source).toHaveTextContent(reviewedCycle.sources[0].note as string);

    // The point of the program: the reviewer is a different runtime.
    const review = within(reviewed).getByTestId("improve-cycle-review");
    expect(
      within(review).getByTestId("improve-review-runtime"),
    ).toHaveTextContent("codex");
    expect(
      within(review).getByTestId("improve-review-verdict-badge"),
    ).toHaveAttribute("data-verdict", ImproveVerdict.CHANGES_REQUESTED);
    expect(
      within(review).getByTestId("improve-review-concerns"),
    ).toHaveTextContent(reviewedCycle.reviews[0].concerns[0]);
    expect(
      within(review).getByTestId("improve-review-stale-sources"),
    ).toHaveTextContent(reviewedCycle.reviews[0].stale_sources[0]);
    expect(
      within(review).getByTestId("improve-review-conversation-link"),
    ).toHaveAttribute("href", "/conversations/conv-review-1");
  });

  it("does not repeat the runtime as the profile name", async () => {
    // Arrange: a profile named after its own runtime, which is the common
    // case on a local stack ("codex", "claude-code").
    const sameName = structuredClone(reviewedCycle);
    sameName.reviews[0].profile_name = "codex";
    vi.mocked(AutomationService.listImproveCycles).mockResolvedValue({
      cycles: [sameName],
      total: 1,
    });

    // Act
    renderPage();
    const [card] = await cycleCards();
    const review = within(card).getByTestId("improve-cycle-review");

    // Assert: the runtime is named once, not printed twice as if the review
    // came from two places.
    expect(within(review).getByTestId("improve-review-runtime")).toHaveTextContent(
      "codex",
    );
    expect(within(review).getAllByText("codex")).toHaveLength(1);
  });

  it("reads SINGLE_RUNTIME as nobody else having reviewed it, not as a pass", async () => {
    renderPage();

    const [single] = await cycleCards();
    expect(
      within(single).getByTestId("improve-cycle-verdict-badge"),
    ).toHaveTextContent(I18nKey.AUTOMATIONS$IMPROVE$VERDICT_SINGLE_RUNTIME);
    expect(
      within(single).getByTestId("improve-cycle-verdict-explanation"),
    ).toHaveTextContent(
      I18nKey.AUTOMATIONS$IMPROVE$VERDICT_SINGLE_RUNTIME_HELP,
    );
    expect(
      within(single).getByTestId("improve-cycle-reviews"),
    ).toHaveTextContent(I18nKey.AUTOMATIONS$IMPROVE$REVIEWS_EMPTY);
    expect(
      within(single).queryByTestId("improve-cycle-review"),
    ).not.toBeInTheDocument();
  });

  it("says so when the program has not run a cycle yet", async () => {
    vi.mocked(AutomationService.listImproveCycles).mockResolvedValue({
      cycles: [],
      total: 0,
    });
    renderPage();

    expect(await screen.findByTestId("improve-cycles-empty")).toHaveTextContent(
      I18nKey.AUTOMATIONS$IMPROVE$NO_CYCLES_BODY,
    );
    // The rotation still renders: there is work queued, just no history.
    expect(await screen.findAllByTestId("improve-rotation-entry")).toHaveLength(
      3,
    );
  });
});
