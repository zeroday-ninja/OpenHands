import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";

import { I18nKey } from "#/i18n/declaration";
import AutomationService from "#/api/automation-service/automation-service.api";
import AgentProfilesService from "#/api/agent-profiles-service/agent-profiles-service.api";
import SoulService, {
  SoulUnsupportedError,
} from "#/api/soul-service/soul-service.api";
import type { SoulResponse } from "#/api/soul-service/soul.types";
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
    listGitSyncRemotes: vi.fn(),
    replaceImproveConfig: vi.fn(),
    refreshImproveCode: vi.fn(),
  },
}));

vi.mock("#/api/agent-profiles-service/agent-profiles-service.api", () => ({
  default: { listProfiles: vi.fn(), getProfile: vi.fn() },
}));

// Only the transport is mocked: whether a backend can serve SOUL.md at all
// is decided by the real `soulUnsupportedReasonFor` / `SoulUnsupportedError`.
vi.mock("#/api/soul-service/soul-service.api", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("#/api/soul-service/soul-service.api")
    >();
  return {
    ...actual,
    default: { getSoul: vi.fn(), saveSoul: vi.fn() },
  };
});

const displayErrorToast = vi.fn();
const displaySuccessToast = vi.fn();

vi.mock("#/utils/custom-toast-handlers", () => ({
  displayErrorToast: (message: string) => displayErrorToast(message),
  displaySuccessToast: (message: string) => displaySuccessToast(message),
}));

const localBackend: Backend = {
  id: "local-1",
  name: "Local 1",
  host: "http://localhost:8000",
  apiKey: "session-key",
  kind: "local",
};

const AUTOMATION_ID = "auto-improve-1";

const BUILDER_ID = "profile-builder";
const CODEX_ID = "profile-codex";
const GEMINI_ID = "profile-gemini";

const config: ImproveProgramConfig = {
  builder_profile_id: BUILDER_ID,
  rotate_builder: [CODEX_ID],
  reviewer_profile_ids: [],
  repository_source: "git_sync",
  repositories: [],
  repository_labels: [],
  branch_prefix: "improve/",
  max_changed_files: 20,
  open_pr: true,
  focus: "Prefer fixing flaky tests.",
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
      updates_checked:
        "Python 3.13 is current; TaskGroup does not replace the callback.",
    },
  ],
  soul_suggestions: [
    {
      text: "Open a pull request against my fork, never the upstream repository.",
      why: "Every branch this cycle pushed went to a fork first, which your standing preferences do not mention.",
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
  soul_suggestions: [],
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

const SUGGESTION = reviewedCycle.soul_suggestions[0];

/** A SOUL.md the user wrote themselves, with no learned-preference section. */
const soul: SoulResponse = {
  content: "# Soul\n\n## How I work\n\n- Read the surrounding code first.\n",
  exists: true,
  path: "/home/leander/.openhands/SOUL.md",
  size_bytes: 62,
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

/**
 * The profile library as the list endpoint answers it. `acp_server` is absent
 * here on purpose: that is what the detail read below is for, and what the
 * form has to resolve a runtime from.
 */
const profileSummaries = [
  { id: BUILDER_ID, name: "Claude builder", agent_kind: "acp" },
  { id: CODEX_ID, name: "Codex", agent_kind: "acp" },
  { id: GEMINI_ID, name: "Gemini", agent_kind: "acp" },
];

const acpServers: Record<string, string> = {
  "Claude builder": "claude-code",
  Codex: "codex",
  Gemini: "gemini-cli",
};

const remotes = {
  remotes: [
    { id: hazard.remote_id, label: hazard.label, repo_url: hazard.url },
    {
      id: pairwatch.remote_id,
      label: pairwatch.label,
      repo_url: pairwatch.url,
    },
    { id: biomoe.remote_id, label: biomoe.label, repo_url: biomoe.url },
  ],
  unassigned_count: 0,
};

beforeEach(() => {
  window.localStorage.clear();
  __resetActiveStoreForTests();
  vi.mocked(AgentProfilesService.listProfiles).mockResolvedValue({
    profiles: profileSummaries,
  } as unknown as Awaited<
    ReturnType<typeof AgentProfilesService.listProfiles>
  >);
  vi.mocked(AgentProfilesService.getProfile).mockImplementation(
    async (name: string) =>
      ({
        profile: {
          agent_kind: "acp",
          name,
          acp_server: acpServers[name],
          acp_model: null,
        },
      }) as unknown as Awaited<
        ReturnType<typeof AgentProfilesService.getProfile>
      >,
  );
  vi.mocked(AutomationService.listGitSyncRemotes).mockResolvedValue(
    remotes as unknown as Awaited<
      ReturnType<typeof AutomationService.listGitSyncRemotes>
    >,
  );
  // The service answers the new rotation, which is how a caller learns what
  // the change put up next.
  vi.mocked(AutomationService.replaceImproveConfig).mockImplementation(
    async (_automationId, saved) => ({ ...rotation, config: saved }),
  );
  vi.mocked(AutomationService.checkHealth).mockResolvedValue({ status: "ok" });
  vi.mocked(AutomationService.getAutomation).mockResolvedValue(automation);
  vi.mocked(AutomationService.getImproveRotation).mockResolvedValue(rotation);
  vi.mocked(AutomationService.refreshImproveCode).mockResolvedValue(automation);
  vi.mocked(AutomationService.listImproveCycles).mockResolvedValue({
    cycles: [unreviewedCycle, reviewedCycle],
    total: 2,
  });
  vi.mocked(SoulService.getSoul).mockResolvedValue(soul);
  vi.mocked(SoulService.saveSoul).mockImplementation(async (content) => ({
    ...soul,
    content,
    size_bytes: content.length,
  }));
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

describe("AutomationImprove packaged code", () => {
  it("offers to update a program running older code", async () => {
    // Arrange: the service says this program's runner is not the code it
    // would package now.
    vi.mocked(AutomationService.getImproveRotation).mockResolvedValue({
      ...rotation,
      preset_code_is_current: false,
    });

    // Act
    renderPage();
    const notice = await screen.findByTestId("improve-stale-code-notice");
    fireEvent.click(within(notice).getByTestId("improve-refresh-code"));

    // Assert
    await waitFor(() =>
      expect(AutomationService.refreshImproveCode).toHaveBeenCalledWith(
        AUTOMATION_ID,
      ),
    );
  });

  it("says nothing when the program is running current code", async () => {
    vi.mocked(AutomationService.getImproveRotation).mockResolvedValue({
      ...rotation,
      preset_code_is_current: true,
    });

    renderPage();
    await screen.findByTestId("improve-rotation");

    expect(
      screen.queryByTestId("improve-stale-code-notice"),
    ).not.toBeInTheDocument();
  });

  it("says nothing when the service gave no verdict", async () => {
    // An automation service from before this landed answers without the
    // field. Silence there means it has nothing to say, which must not render
    // as "your program is out of date".
    renderPage();
    await screen.findByTestId("improve-rotation");

    expect(
      screen.queryByTestId("improve-stale-code-notice"),
    ).not.toBeInTheDocument();
  });

  it("keeps saying the code is old when the update fails", async () => {
    // Arrange: the refresh is refused. The program is still on the old code,
    // so the notice must not disappear as if the update had worked.
    vi.mocked(AutomationService.getImproveRotation).mockResolvedValue({
      ...rotation,
      preset_code_is_current: false,
    });
    vi.mocked(AutomationService.refreshImproveCode).mockRejectedValue(
      new Error("tarball upload failed"),
    );

    // Act
    renderPage();
    const notice = await screen.findByTestId("improve-stale-code-notice");
    fireEvent.click(within(notice).getByTestId("improve-refresh-code"));

    // Assert
    expect(
      await within(notice).findByTestId("improve-stale-code-error"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("improve-stale-code-notice")).toBeInTheDocument();
  });
});

describe("AutomationImprove cycle history", () => {
  it("does not offer a conversation a reaped cycle no longer has", async () => {
    // Arrange: the janitor closed this cycle because its run ended and
    // nobody reported it, which deletes the sandbox with it. The link was
    // offered anyway and led nowhere — and the card already holds what
    // survives, which is the stored report.
    vi.mocked(AutomationService.listImproveCycles).mockResolvedValue({
      cycles: [{ ...reviewedCycle, reaped: true }],
      total: 1,
    });

    // Act
    renderPage();
    const card = await screen.findByTestId("improve-cycle-card");

    // Assert
    expect(
      within(card).queryByTestId("improve-builder-conversation-link"),
    ).not.toBeInTheDocument();
    expect(
      within(card).getByTestId("improve-builder-conversation-gone"),
    ).toBeVisible();
    // And no reviewer's conversation either: they were in the same sandbox.
    expect(
      within(card).queryByTestId("improve-review-conversation-link"),
    ).not.toBeInTheDocument();
  });

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
      within(review).getByTestId("improve-review-updates-checked"),
    ).toHaveTextContent(reviewedCycle.reviews[0].updates_checked as string);
    expect(
      within(review).getByTestId("improve-review-conversation-link"),
    ).toHaveAttribute("href", "/conversations/conv-review-1");
  });

  it("says a change merged, and links the commit it became", async () => {
    // Arrange: an additive change that merged itself, which is the one case
    // the user never confirmed and so never saw happen.
    const merged = structuredClone(reviewedCycle);
    merged.verdict = ImproveVerdict.ACCEPTED;
    merged.merged_at = "2026-10-24T18:01:17Z";
    merged.merge_commit_sha = "666481f3154c7f6ce6551a674b9d3205dd724297";
    vi.mocked(AutomationService.listImproveCycles).mockResolvedValue({
      cycles: [merged],
      total: 1,
    });

    // Act
    renderPage();
    const [card] = await cycleCards();

    // Assert
    expect(within(card).getByTestId("improve-cycle-merged")).toHaveTextContent(
      "666481f",
    );
    expect(
      within(card).getByTestId("improve-cycle-merge-commit"),
    ).toHaveAttribute(
      "href",
      "https://github.com/zeroday-ninja/HAZARD/commit/666481f3154c7f6ce6551a674b9d3205dd724297",
    );
  });

  it("stays silent about merging when the service never said", async () => {
    // A service from before the merge was recorded sends neither field, and
    // that is not the same as "did not merge": claiming either way would be
    // inventing an answer.
    renderPage();
    const [, reviewed] = await cycleCards();

    expect(
      within(reviewed).queryByTestId("improve-cycle-merged"),
    ).not.toBeInTheDocument();
  });

  it("shows the commit as text when the forge's commit path is unknown", async () => {
    // Arrange: a self-hosted forge. A guessed path that 404s is worse than
    // the SHA alone, which is still enough to run `git show`.
    const merged = structuredClone(reviewedCycle);
    merged.repository = {
      ...merged.repository,
      url: "https://git.example.test/me/app",
    };
    merged.merged_at = "2026-10-24T18:01:17Z";
    merged.merge_commit_sha = "666481f3154c7f6ce6551a674b9d3205dd724297";
    vi.mocked(AutomationService.listImproveCycles).mockResolvedValue({
      cycles: [merged],
      total: 1,
    });

    // Act
    renderPage();
    const [card] = await cycleCards();

    // Assert
    const commit = within(card).getByTestId("improve-cycle-merge-commit");
    expect(commit).toHaveTextContent("666481f");
    expect(commit).not.toHaveAttribute("href");
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
    expect(
      within(review).getByTestId("improve-review-runtime"),
    ).toHaveTextContent("codex");
    expect(within(review).getAllByText("codex")).toHaveLength(1);
  });

  it("distinguishes a reviewer that said nothing from one that found nothing newer", async () => {
    // Arrange: the reviewer never answered the supersession question.
    const silent = structuredClone(reviewedCycle);
    silent.reviews[0].updates_checked = null;
    vi.mocked(AutomationService.listImproveCycles).mockResolvedValue({
      cycles: [silent],
      total: 1,
    });

    // Act
    renderPage();
    const [card] = await cycleCards();
    const review = within(card).getByTestId("improve-cycle-review");

    // Assert: the section still renders, saying the question went unanswered,
    // which must not be mistaken for a reviewer reporting nothing newer.
    expect(
      within(review).getByTestId("improve-review-updates-checked"),
    ).toHaveTextContent(I18nKey.AUTOMATIONS$IMPROVE$REVIEW_UPDATES_UNANSWERED);
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

describe("AutomationImprove learned preferences", () => {
  /**
   * Only `Date` is faked, so the dated bullet is deterministic while React
   * Query's and Testing Library's own timers stay real.
   */
  const freezeToday = () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 22, 9, 0, 0));
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * The action, once SOUL.md itself has loaded: an append needs the document
   * it is appending to, so the button renders disabled until the read lands.
   */
  const addButton = async () => {
    const button = await screen.findByTestId("improve-soul-suggestion-add");
    await waitFor(() => expect(button).toBeEnabled());
    return button;
  };

  it("tells a proposal about the user apart from the cycle's project findings", async () => {
    renderPage();

    const proposal = await screen.findByTestId("improve-soul-suggestion");
    expect(
      within(proposal).getByTestId("improve-soul-suggestion-text"),
    ).toHaveTextContent(SUGGESTION.text);
    expect(
      within(proposal).getByTestId("improve-soul-suggestion-why"),
    ).toHaveTextContent(SUGGESTION.why as string);
    // Stated in words, because every other section on the card is about the
    // repository rather than about the user.
    expect(
      screen.getByTestId("improve-cycle-soul-suggestions"),
    ).toHaveTextContent(
      I18nKey.AUTOMATIONS$IMPROVE$SOUL_SUGGESTIONS_DESCRIPTION,
    );
    // A cycle that proposed nothing says nothing: only one card has a section.
    expect(
      screen.getAllByTestId("improve-cycle-soul-suggestions"),
    ).toHaveLength(1);
  });

  it("appends the proposal under a learned-preferences section it creates", async () => {
    freezeToday();
    renderPage();

    fireEvent.click(await addButton());

    // The saved document is the state, so the proposal now reads as added.
    await screen.findByTestId("improve-soul-suggestion-added");
    expect(SoulService.saveSoul).toHaveBeenCalledWith(
      "# Soul\n\n## How I work\n\n- Read the surrounding code first.\n\n## Learned preferences\n\n- 2026-10-22: Open a pull request against my fork, never the upstream repository.\n",
    );
    expect(displaySuccessToast).toHaveBeenCalledWith(
      I18nKey.AUTOMATIONS$IMPROVE$SOUL_SUGGESTION_ADDED_TOAST,
    );
  });

  it("adds to the existing section rather than starting a second one", async () => {
    freezeToday();
    vi.mocked(SoulService.getSoul).mockResolvedValue({
      ...soul,
      content:
        "# Soul\n\n## Learned preferences\n\n- 2026-10-01: Keep commits small.\n\n## How I work\n\n- Read the surrounding code first.\n",
    });
    renderPage();

    fireEvent.click(await addButton());
    await screen.findByTestId("improve-soul-suggestion-added");

    // The new bullet joins the list it belongs to; the user's own section
    // after it keeps its place and its wording.
    expect(SoulService.saveSoul).toHaveBeenCalledWith(
      "# Soul\n\n## Learned preferences\n\n- 2026-10-01: Keep commits small.\n- 2026-10-22: Open a pull request against my fork, never the upstream repository.\n\n## How I work\n\n- Read the surrounding code first.\n",
    );
  });

  it("reads a preference the document already states as already added", async () => {
    vi.mocked(SoulService.getSoul).mockResolvedValue({
      ...soul,
      content: `${soul.content}\n## Learned preferences\n\n- 2026-10-02: ${SUGGESTION.text}\n`,
    });
    renderPage();

    expect(
      await screen.findByTestId("improve-soul-suggestion-added"),
    ).toHaveTextContent(
      I18nKey.AUTOMATIONS$IMPROVE$SOUL_SUGGESTION_ALREADY_ADDED,
    );
    expect(
      screen.queryByTestId("improve-soul-suggestion-add"),
    ).not.toBeInTheDocument();
  });

  it("keeps the proposals readable on a backend that cannot store them", async () => {
    vi.mocked(SoulService.getSoul).mockRejectedValue(
      new SoulUnsupportedError("missing-api"),
    );
    renderPage();

    expect(
      await screen.findByTestId("improve-soul-suggestions-read-only"),
    ).toHaveTextContent(I18nKey.AUTOMATIONS$IMPROVE$SOUL_SUGGESTIONS_READ_ONLY);
    expect(
      screen.getByTestId("improve-soul-suggestion-text"),
    ).toHaveTextContent(SUGGESTION.text);
    expect(
      screen.queryByTestId("improve-soul-suggestion-add"),
    ).not.toBeInTheDocument();
  });

  it("writes once per click and leaves the action usable after a failure", async () => {
    let failSave: (error: Error) => void = () => {};
    vi.mocked(SoulService.saveSoul).mockReturnValue(
      new Promise((_resolve, reject) => {
        failSave = reject;
      }),
    );
    renderPage();
    const button = await addButton();

    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(button).toBeDisabled());
    failSave(new Error("could not write SOUL.md"));

    // The failure hands the action back rather than leaving it stuck.
    await waitFor(() => expect(button).toBeEnabled());
    // One click, one append: a second write built on the same base content
    // would silently drop the first.
    expect(SoulService.saveSoul).toHaveBeenCalledTimes(1);
    expect(displayErrorToast).toHaveBeenCalledTimes(1);
  });
});

describe("AutomationImprove configuration", () => {
  /** The form, once the profile library it offers has landed. */
  const form = async () => {
    await screen.findByTestId("improve-config-form");
    await waitFor(() =>
      expect(screen.getByTestId("improve-config-builder")).not.toBeDisabled(),
    );
    return screen.getByTestId("improve-config-form");
  };

  const save = async () => {
    fireEvent.click(screen.getByTestId("improve-config-save"));
    await waitFor(() =>
      expect(AutomationService.replaceImproveConfig).toHaveBeenCalled(),
    );
  };

  const rotationOption = (profileId: string) =>
    screen
      .getAllByTestId("improve-config-rotation-option")
      .find((option) => option.dataset.profileId === profileId) as HTMLElement;

  const reviewerOption = (profileId: string) =>
    screen
      .getAllByTestId("improve-config-reviewer-option")
      .find((option) => option.dataset.profileId === profileId) as HTMLElement;

  it("loads the program's stored configuration, including what an empty reviewer list means", async () => {
    // Arrange / Act
    renderPage();
    await form();

    // Assert — every field the program actually has, not just name and schedule.
    expect(screen.getByTestId("improve-config-builder")).toHaveValue(
      BUILDER_ID,
    );
    expect(rotationOption(CODEX_ID)).toBeChecked();
    expect(rotationOption(GEMINI_ID)).not.toBeChecked();
    // An empty stored reviewer list is "every other runtime", not "nobody".
    expect(
      screen.getByTestId("improve-config-reviewers-automatic"),
    ).toBeChecked();
    expect(screen.getByTestId("improve-config-branch-prefix")).toHaveValue(
      config.branch_prefix,
    );
    expect(screen.getByTestId("improve-config-max-files")).toHaveValue(
      config.max_changed_files,
    );
    expect(screen.getByTestId("improve-config-open-pr")).toBeChecked();
    expect(screen.getByTestId("improve-config-focus")).toHaveValue(
      config.focus as string,
    );
    // The profile's runtime is in the option, since that is what makes a
    // review independent.
    expect(screen.getByTestId("improve-config-builder")).toHaveTextContent(
      "Claude builder",
    );
  });

  it("sends the whole configuration to the program's config endpoint", async () => {
    renderPage();
    await form();

    fireEvent.change(screen.getByTestId("improve-config-focus"), {
      target: { value: "Prefer accessibility fixes." },
    });
    fireEvent.change(screen.getByTestId("improve-config-max-files"), {
      target: { value: "8" },
    });
    fireEvent.click(rotationOption(GEMINI_ID));
    await save();

    expect(AutomationService.replaceImproveConfig).toHaveBeenCalledWith(
      AUTOMATION_ID,
      {
        ...config,
        rotate_builder: [CODEX_ID, GEMINI_ID],
        max_changed_files: 8,
        focus: "Prefer accessibility fixes.",
      },
    );
  });

  it("cannot send chosen reviewers together with a rotating builder", async () => {
    renderPage();
    await form();

    // Act — name the reviewers on a program that rotates its builder, the
    // combination the service answers 422 for.
    fireEvent.click(screen.getByTestId("improve-config-reviewers-chosen"));

    // Assert — the rotation is no longer offered, and says why.
    expect(
      screen.getByTestId("improve-config-rotation-unavailable"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("improve-config-rotation-option"),
    ).not.toBeInTheDocument();
    // Reviewers are required once chosen explicitly, so there is nothing to
    // send until one is picked.
    expect(
      screen.getByTestId("improve-config-reviewers-error"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("improve-config-save")).toBeDisabled();

    fireEvent.click(reviewerOption(CODEX_ID));
    await save();

    expect(AutomationService.replaceImproveConfig).toHaveBeenCalledWith(
      AUTOMATION_ID,
      { ...config, rotate_builder: [], reviewer_profile_ids: [CODEX_ID] },
    );
  });

  it("swaps which repository fields apply when the source changes", async () => {
    renderPage();
    await form();

    // The synced-repository filter is what a git_sync program narrows with.
    expect(screen.getByTestId("improve-config-labels")).toBeInTheDocument();
    fireEvent.click(
      screen
        .getAllByTestId("improve-config-label-option")
        .find((option) => option.dataset.label === hazard.label) as HTMLElement,
    );

    // Act — its own list instead.
    fireEvent.click(screen.getByTestId("improve-config-source-explicit"));

    // Assert — the filter no longer applies, and a list is required.
    expect(
      screen.queryByTestId("improve-config-labels"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("improve-config-repositories-error"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("improve-config-save")).toBeDisabled();

    fireEvent.click(screen.getByTestId("improve-config-repository-add"));
    fireEvent.change(screen.getByTestId("improve-config-repository-label"), {
      target: { value: "hazard" },
    });
    fireEvent.change(screen.getByTestId("improve-config-repository-url"), {
      target: { value: "https://github.com/zeroday-ninja/HAZARD" },
    });
    await save();

    // The label picked for the other source is gone from the payload rather
    // than sent alongside a list the service refuses it with.
    expect(AutomationService.replaceImproveConfig).toHaveBeenCalledWith(
      AUTOMATION_ID,
      {
        ...config,
        repository_source: "explicit",
        repository_labels: [],
        repositories: [
          {
            label: "hazard",
            url: "https://github.com/zeroday-ninja/HAZARD",
            ref: null,
          },
        ],
      },
    );
  });

  it("refuses a repository URL a cycle could not clone before sending anything", async () => {
    renderPage();
    await form();
    fireEvent.click(screen.getByTestId("improve-config-source-explicit"));
    fireEvent.click(screen.getByTestId("improve-config-repository-add"));
    fireEvent.change(screen.getByTestId("improve-config-repository-label"), {
      target: { value: "hazard" },
    });

    fireEvent.change(screen.getByTestId("improve-config-repository-url"), {
      target: { value: "http://github.com/zeroday-ninja/HAZARD" },
    });

    expect(
      screen.getByTestId("improve-config-repository-url-error"),
    ).toHaveTextContent(
      I18nKey.AUTOMATIONS$IMPROVE$CONFIG_REPOSITORY_URL_INVALID,
    );
    fireEvent.click(screen.getByTestId("improve-config-save"));
    expect(AutomationService.replaceImproveConfig).not.toHaveBeenCalled();
  });

  it("shows which repository is up next from the rotation the save answered with", async () => {
    // Arrange — the saved configuration narrows the rotation to one
    // repository, so what runs next changes with it.
    vi.mocked(AutomationService.replaceImproveConfig).mockImplementation(
      async (_automationId, saved) => ({
        repositories: [{ ...biomoe, index: 0 }],
        next_index: 0,
        last_cycle: null,
        config: saved,
      }),
    );
    renderPage();
    await form();

    // Act
    fireEvent.click(
      screen
        .getAllByTestId("improve-config-label-option")
        .find((option) => option.dataset.label === biomoe.label) as HTMLElement,
    );
    await save();

    // Assert — the page answers "what now?" without a reload.
    const entries = await screen.findAllByTestId("improve-rotation-entry");
    expect(entries).toHaveLength(1);
    expect(entries[0].dataset.repository).toBe(biomoe.url);
    expect(
      within(entries[0]).getByTestId("improve-rotation-up-next"),
    ).toBeInTheDocument();
    expect(displaySuccessToast).toHaveBeenCalledWith(
      I18nKey.AUTOMATIONS$IMPROVE$CONFIG_SAVED,
    );
  });
});
