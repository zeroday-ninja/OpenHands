import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";

import { I18nKey } from "#/i18n/declaration";
import SoulService, {
  SoulUnsupportedError,
} from "#/api/soul-service/soul-service.api";
import {
  MAX_SOUL_LENGTH,
  type SoulResponse,
} from "#/api/soul-service/soul.types";
import {
  __resetActiveStoreForTests,
  setActiveSelection,
  setRegisteredBackends,
} from "#/api/backend-registry/active-store";
import { ActiveBackendProvider } from "#/contexts/active-backend-context";
import SoulSettingsScreen from "#/routes/soul-settings";
import type { Backend } from "#/api/backend-registry/types";

// Only the transport methods are mocked: the page's unsupported handling keys
// off the real `SoulUnsupportedError` / `soulUnsupportedReasonFor`, and
// `soul-service.api.test.ts` covers the 404 that produces "missing-api".
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

const cloudBackend: Backend = {
  id: "cloud-1",
  name: "Cloud 1",
  host: "https://app.all-hands.dev",
  apiKey: "cloud-key",
  kind: "cloud",
};

const ownSoul: SoulResponse = {
  content: "# Soul\n\nAsk before refactoring something I did not mention.\n",
  exists: true,
  path: "/home/leander/.openhands/SOUL.md",
  size_bytes: 58,
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ActiveBackendProvider>
        <MemoryRouter initialEntries={["/settings/soul"]}>
          <Routes>
            <Route path="/settings/soul" element={<SoulSettingsScreen />} />
          </Routes>
        </MemoryRouter>
      </ActiveBackendProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  __resetActiveStoreForTests();
  vi.mocked(SoulService.getSoul).mockResolvedValue(ownSoul);
  vi.mocked(SoulService.saveSoul).mockResolvedValue(ownSoul);
  setRegisteredBackends([localBackend]);
  setActiveSelection({ backendId: localBackend.id });
});

afterEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  __resetActiveStoreForTests();
});

describe("SoulSettingsScreen", () => {
  it("shows the user's own file with its path, and saves an edit", async () => {
    const edited = `${ownSoul.content}Never force-push my branches.\n`;
    vi.mocked(SoulService.saveSoul).mockResolvedValue({
      ...ownSoul,
      content: edited,
      size_bytes: edited.length,
    });
    renderPage();

    const editor = await screen.findByTestId("soul-content-input");
    expect(editor).toHaveValue(ownSoul.content);
    expect(screen.getByTestId("soul-origin")).toHaveAttribute(
      "data-exists",
      "true",
    );
    expect(screen.getByTestId("soul-path")).toHaveTextContent(ownSoul.path);
    // Nothing is dirty yet, so there is nothing to save.
    expect(screen.getByTestId("soul-save-button")).toBeDisabled();

    fireEvent.change(editor, { target: { value: edited } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("soul-save-button"));
    });

    expect(SoulService.saveSoul).toHaveBeenCalledWith(edited);
    expect(displaySuccessToast).toHaveBeenCalledWith(
      I18nKey.SETTINGS$SOUL_SAVED,
    );
    // The editor now reflects what the server stored, not the draft.
    expect(await screen.findByTestId("soul-content-input")).toHaveValue(edited);
  });

  it("shows the built-in default, with nothing to revert, when the user has no file", async () => {
    vi.mocked(SoulService.getSoul).mockResolvedValue({
      ...ownSoul,
      content: "# Soul\n\nBuilt-in default.\n",
      exists: false,
    });
    renderPage();

    await screen.findByTestId("soul-content-input");
    expect(screen.getByTestId("soul-origin")).toHaveAttribute(
      "data-exists",
      "false",
    );
    // There is no file to delete, so the revert action has nothing to do.
    expect(screen.getByTestId("soul-revert-button")).toBeDisabled();
  });

  it("deletes the file only after confirmation, by saving empty content", async () => {
    renderPage();

    fireEvent.click(await screen.findByTestId("soul-revert-button"));
    const modal = screen.getByTestId("confirmation-modal");
    expect(modal).toHaveTextContent(I18nKey.SETTINGS$SOUL_REVERT_CONFIRM);
    expect(SoulService.saveSoul).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(within(modal).getByTestId("confirm-button"));
    });

    expect(SoulService.saveSoul).toHaveBeenCalledWith("");
    expect(displaySuccessToast).toHaveBeenCalledWith(
      I18nKey.SETTINGS$SOUL_REVERTED,
    );
  });

  it("refuses to save content past the length the server accepts", async () => {
    renderPage();

    const editor = await screen.findByTestId("soul-content-input");
    fireEvent.change(editor, {
      target: { value: "x".repeat(MAX_SOUL_LENGTH + 1) },
    });

    expect(screen.getByTestId("soul-too-long")).toBeInTheDocument();
    expect(editor).toHaveAttribute("aria-invalid", "true");
    fireEvent.click(screen.getByTestId("soul-save-button"));
    expect(SoulService.saveSoul).not.toHaveBeenCalled();
  });

  it("explains an agent server without the route instead of failing", async () => {
    vi.mocked(SoulService.getSoul).mockRejectedValue(
      new SoulUnsupportedError("missing-api"),
    );
    renderPage();

    const unsupported = await screen.findByTestId("soul-unsupported");
    expect(unsupported).toHaveAttribute("data-reason", "missing-api");
    expect(unsupported).toHaveTextContent(
      I18nKey.SETTINGS$SOUL_UNSUPPORTED_MISSING_API,
    );
    expect(screen.queryByTestId("soul-content-input")).not.toBeInTheDocument();
  });

  it("never asks a cloud backend, which has no SOUL.md", async () => {
    setRegisteredBackends([localBackend, cloudBackend]);
    setActiveSelection({ backendId: cloudBackend.id });
    renderPage();

    const unsupported = await screen.findByTestId("soul-unsupported");
    expect(unsupported).toHaveAttribute("data-reason", "cloud-backend");
    expect(SoulService.getSoul).not.toHaveBeenCalled();
  });
});
