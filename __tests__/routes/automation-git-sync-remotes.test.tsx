import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { HttpError } from "@openhands/typescript-client";

import { I18nKey } from "#/i18n/declaration";
import AutomationService from "#/api/automation-service/automation-service.api";
import {
  __resetActiveStoreForTests,
  setActiveSelection,
  setRegisteredBackends,
} from "#/api/backend-registry/active-store";
import { ActiveBackendProvider } from "#/contexts/active-backend-context";
import AutomationGitSync from "#/routes/automation-git-sync";
import type { Backend } from "#/api/backend-registry/types";
import type {
  GitSyncAssignmentsResponse,
  GitSyncRemoteStatus,
  GitSyncRemotesResponse,
} from "#/types/git-sync";

vi.mock("#/api/automation-service/automation-service.api", () => ({
  default: {
    checkHealth: vi.fn(),
    getGitSyncStatus: vi.fn(),
    updateGitSyncConfig: vi.fn(),
    checkGitSyncConfig: vi.fn(),
    triggerGitSync: vi.fn(),
    listGitSyncRemotes: vi.fn(),
    createGitSyncRemote: vi.fn(),
    updateGitSyncRemote: vi.fn(),
    deleteGitSyncRemote: vi.fn(),
    checkGitSyncRemote: vi.fn(),
    triggerGitSyncRemote: vi.fn(),
    listGitSyncAssignments: vi.fn(),
    assignGitSyncRemote: vi.fn(),
  },
}));

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

const hazard: GitSyncRemoteStatus = {
  id: "remote-hazard",
  label: "",
  is_default: true,
  automation_count: 2,
  enabled: true,
  repo_url: "https://github.com/zeroday-ninja/HAZARD",
  branch: "main",
  path: "automations",
  encryption_enabled: false,
  interval_seconds: 9000,
  last_synced_commit: "a5a9309eb529758c33a915da314e6982171d1504",
  last_synced_at: "2026-10-21T03:23:56Z",
  last_error: null,
  last_error_at: null,
  dirty_count: 0,
};

const pairwatch: GitSyncRemoteStatus = {
  ...hazard,
  id: "remote-pairwatch",
  label: "pairwatch",
  is_default: false,
  automation_count: 1,
  repo_url: "https://github.com/zeroday-ninja/pairwatch",
  last_synced_commit: null,
  last_synced_at: null,
};

const remotes: GitSyncRemotesResponse = {
  remotes: [hazard, pairwatch],
  unassigned_count: 0,
};

const assignments: GitSyncAssignmentsResponse = {
  automations: [
    {
      automation_id: "auto-1",
      name: "Node graph layout",
      remote_id: null,
      effective_remote_id: hazard.id,
      slug: null,
      dirty: true,
    },
    {
      automation_id: "auto-2",
      name: "Nightly pair review",
      remote_id: pairwatch.id,
      effective_remote_id: pairwatch.id,
      slug: "nightly-pair-review",
      dirty: false,
    },
  ],
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ActiveBackendProvider>
        <MemoryRouter initialEntries={["/automations/git-sync"]}>
          <Routes>
            <Route
              path="/automations/git-sync"
              element={<AutomationGitSync />}
            />
          </Routes>
        </MemoryRouter>
      </ActiveBackendProvider>
    </QueryClientProvider>,
  );
}

const cards = () => screen.getAllByTestId("git-sync-remote-card");

beforeEach(() => {
  window.localStorage.clear();
  __resetActiveStoreForTests();
  vi.mocked(AutomationService.checkHealth).mockResolvedValue({ status: "ok" });
  vi.mocked(AutomationService.listGitSyncRemotes).mockResolvedValue(remotes);
  vi.mocked(AutomationService.listGitSyncAssignments).mockResolvedValue(
    assignments,
  );
  vi.mocked(AutomationService.triggerGitSyncRemote).mockResolvedValue({
    triggered: true,
  });
  vi.mocked(AutomationService.checkGitSyncRemote).mockResolvedValue({
    ok: true,
    branch_exists: true,
    detail: null,
  });
  setRegisteredBackends([localBackend]);
  setActiveSelection({ backendId: localBackend.id });
});

afterEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  __resetActiveStoreForTests();
});

describe("AutomationGitSync with repositories", () => {
  it("lists every repository, marking the default and naming each by label or URL", async () => {
    renderPage();

    const [first, second] = await screen.findAllByTestId(
      "git-sync-remote-card",
    );
    expect(first).toHaveAttribute("data-default", "true");
    expect(
      within(first).getByTestId("git-sync-default-pill"),
    ).toBeInTheDocument();
    // No label: the repository stands in, without the .git noise or credentials.
    expect(
      within(first).getByRole("heading", {
        name: "https://github.com/zeroday-ninja/HAZARD",
      }),
    ).toBeInTheDocument();
    expect(
      within(first).getByTestId("git-sync-automation-count"),
    ).toHaveTextContent("2");
    expect(
      within(second).getByRole("heading", { name: "pairwatch" }),
    ).toBeInTheDocument();
    expect(
      within(second).queryByTestId("git-sync-default-pill"),
    ).not.toBeInTheDocument();
    expect(
      within(second).getByTestId("git-sync-make-default-button"),
    ).toBeInTheDocument();
    // The legacy single-repository status is never asked for.
    expect(AutomationService.getGitSyncStatus).not.toHaveBeenCalled();
  });

  it("adds a repository, then syncs it when asked to", async () => {
    const created: GitSyncRemoteStatus = {
      ...pairwatch,
      id: "remote-biomoe",
      label: "biomoe",
      repo_url: "https://github.com/zeroday-ninja/biomoe",
    };
    vi.mocked(AutomationService.createGitSyncRemote).mockResolvedValue(created);
    vi.mocked(AutomationService.listGitSyncRemotes)
      .mockResolvedValueOnce(remotes)
      .mockResolvedValue({
        ...remotes,
        remotes: [...remotes.remotes, created],
      });
    renderPage();

    fireEvent.click(await screen.findByTestId("git-sync-add-remote-button"));
    const form = screen.getByTestId("git-sync-new-remote-form");
    fireEvent.change(within(form).getByTestId("git-sync-label-input"), {
      target: { value: "biomoe" },
    });
    fireEvent.change(within(form).getByTestId("git-sync-repo-url-input"), {
      target: { value: "https://github.com/zeroday-ninja/biomoe" },
    });
    await act(async () => {
      fireEvent.click(
        within(form).getByTestId("git-sync-save-and-sync-button"),
      );
    });

    expect(AutomationService.createGitSyncRemote).toHaveBeenCalledWith({
      label: "biomoe",
      repo_url: "https://github.com/zeroday-ninja/biomoe",
    });
    expect(AutomationService.triggerGitSyncRemote).toHaveBeenCalledWith(
      "remote-biomoe",
    );
    expect(
      await screen.findByRole("heading", { name: "biomoe" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("git-sync-new-remote-form"),
    ).not.toBeInTheDocument();
    // The new card opens on its configuration, where a typo is fixed.
    const newCard = cards().find(
      (card) => card.getAttribute("data-remote-id") === "remote-biomoe",
    );
    expect(newCard).toBeDefined();
    expect(
      within(newCard as HTMLElement).getByTestId("git-sync-label-input"),
    ).toHaveValue("biomoe");
  });

  it("promotes a repository to default", async () => {
    vi.mocked(AutomationService.updateGitSyncRemote).mockResolvedValue({
      ...pairwatch,
      is_default: true,
    });
    renderPage();

    const [, second] = await screen.findAllByTestId("git-sync-remote-card");
    await act(async () => {
      fireEvent.click(
        within(second).getByTestId("git-sync-make-default-button"),
      );
    });

    expect(AutomationService.updateGitSyncRemote).toHaveBeenCalledWith(
      pairwatch.id,
      { is_default: true },
    );
  });

  it("removes a repository only after confirmation", async () => {
    vi.mocked(AutomationService.deleteGitSyncRemote).mockResolvedValue();
    renderPage();

    const [, second] = await screen.findAllByTestId("git-sync-remote-card");
    fireEvent.click(within(second).getByTestId("git-sync-remove-button"));
    const modal = screen.getByTestId("confirmation-modal");
    expect(modal).toHaveTextContent(
      I18nKey.AUTOMATIONS$GIT_SYNC$REMOVE_CONFIRM_MESSAGE,
    );
    expect(AutomationService.deleteGitSyncRemote).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(within(modal).getByTestId("confirm-button"));
    });

    expect(AutomationService.deleteGitSyncRemote).toHaveBeenCalledWith(
      pairwatch.id,
    );
    expect(displaySuccessToast).toHaveBeenCalledWith(
      I18nKey.AUTOMATIONS$GIT_SYNC$REPOSITORY_REMOVED,
    );
  });

  it("shows where each automation syncs and moves one to another repository", async () => {
    vi.mocked(AutomationService.assignGitSyncRemote).mockResolvedValue({
      ...assignments.automations[0],
      remote_id: pairwatch.id,
      effective_remote_id: pairwatch.id,
      slug: "node-graph-layout",
    });
    renderPage();

    const rows = await screen.findAllByTestId("git-sync-assignment-row");
    expect(rows).toHaveLength(2);
    // Unassigned follows the default, so the picker already shows it.
    const first = within(rows[0]).getByTestId("git-sync-assignment-select");
    expect(first).toHaveValue(hazard.id);
    expect(
      within(rows[1]).getByTestId("git-sync-assignment-select"),
    ).toHaveValue(pairwatch.id);

    await act(async () => {
      fireEvent.change(first, { target: { value: pairwatch.id } });
    });

    expect(AutomationService.assignGitSyncRemote).toHaveBeenCalledWith(
      "auto-1",
      pairwatch.id,
    );
    expect(displaySuccessToast).toHaveBeenCalledWith(
      I18nKey.AUTOMATIONS$GIT_SYNC$AUTOMATION_MOVED,
    );
  });

  it("follows a remote's own Sync now through the activity row", async () => {
    renderPage();

    const [first] = await screen.findAllByTestId("git-sync-remote-card");
    await act(async () => {
      fireEvent.click(within(first).getByTestId("git-sync-now-button"));
    });

    expect(AutomationService.triggerGitSyncRemote).toHaveBeenCalledWith(
      hazard.id,
    );
    expect(within(first).getByTestId("git-sync-activity-row")).toHaveAttribute(
      "data-state",
      "running",
    );
    expect(AutomationService.triggerGitSync).not.toHaveBeenCalled();
  });

  it("invites the first repository when there are none", async () => {
    vi.mocked(AutomationService.listGitSyncRemotes).mockResolvedValue({
      remotes: [],
      unassigned_count: 3,
    });
    renderPage();

    expect(
      await screen.findByTestId("git-sync-no-remotes"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("git-sync-remote-card"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("git-sync-assignment-row"),
    ).not.toBeInTheDocument();
  });

  it("falls back to the single-repository page on a backend without remotes", async () => {
    vi.mocked(AutomationService.listGitSyncRemotes).mockRejectedValue(
      new HttpError(404, "Not Found", { detail: "Not Found" }),
    );
    vi.mocked(AutomationService.getGitSyncStatus).mockResolvedValue(hazard);
    renderPage();

    expect(
      await screen.findByText(I18nKey.AUTOMATIONS$GIT_SYNC$SUBTITLE),
    ).toBeInTheDocument();
    expect(screen.getByTestId("git-sync-repo-url-input")).toHaveValue(
      hazard.repo_url,
    );
    expect(
      screen.queryByTestId("git-sync-add-remote-button"),
    ).not.toBeInTheDocument();
    // A permanent 404 is not worth retrying.
    expect(AutomationService.listGitSyncRemotes).toHaveBeenCalledTimes(1);
  });

  it("shows the error panel when the list cannot be loaded at all", async () => {
    vi.mocked(AutomationService.listGitSyncRemotes).mockRejectedValue(
      new HttpError(500, "Server Error", { detail: "db down" }),
    );
    renderPage();

    expect(
      await screen.findByRole("button", { name: I18nKey.AUTOMATIONS$ERROR_RETRY }),
    ).toBeInTheDocument();
    expect(AutomationService.getGitSyncStatus).not.toHaveBeenCalled();
  });
});
