import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";

import { I18nKey } from "#/i18n/declaration";
import SoulService, {
  SoulUnsupportedError,
} from "#/api/soul-service/soul-service.api";
import {
  MAX_IDENTITY_DOCUMENT_LENGTH,
  type IdentityDocumentResponse,
  type IdentitySetResponse,
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
    default: { getIdentityDocuments: vi.fn(), saveIdentityDocument: vi.fn() },
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

const IDENTITY_DIRECTORY = "/home/leander/.openhands/soul";

function makeDocument(
  name: string,
  relativePath: string,
  purpose: string,
  content = "",
): IdentityDocumentResponse {
  return {
    name,
    relative_path: relativePath,
    purpose,
    content,
    exists: content !== "",
    path: `${IDENTITY_DIRECTORY}/${relativePath}`,
    size_bytes: content.length,
  };
}

const soulDocument = makeDocument(
  "soul",
  "SOUL.md",
  "Who you are: background, worldview, opinions by domain.",
  "# Soul\n\nAsk before refactoring something I did not mention.\n",
);
const styleDocument = makeDocument(
  "style",
  "STYLE.md",
  "How you write and work: voice, words you use and never use.",
);
const memoryDocument = makeDocument(
  "memory",
  "MEMORY.md",
  "Continuity across sessions.",
);

/** The server's order is the order a prompt reads the documents in. */
const identitySet: IdentitySetResponse = {
  documents: [soulDocument, styleDocument, memoryDocument],
  directory: IDENTITY_DIRECTORY,
};

function sectionFor(name: string): HTMLElement {
  return screen
    .getAllByTestId("identity-document-section")
    .find((section) => section.getAttribute("data-name") === name)!;
}

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
  vi.mocked(SoulService.getIdentityDocuments).mockResolvedValue(identitySet);
  vi.mocked(SoulService.saveIdentityDocument).mockResolvedValue(styleDocument);
  setRegisteredBackends([localBackend]);
  setActiveSelection({ backendId: localBackend.id });
});

afterEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  __resetActiveStoreForTests();
});

describe("SoulSettingsScreen", () => {
  it("lists every document in the order the agent reads them, with what belongs in each", async () => {
    renderPage();

    await screen.findByTestId("identity-documents-editor");
    const sections = screen.getAllByTestId("identity-document-section");
    expect(
      sections.map((section) => section.getAttribute("data-name")),
    ).toEqual(["soul", "style", "memory"]);
    sections.forEach((section, index) => {
      const expected = identitySet.documents[index];
      expect(
        within(section).getByTestId("identity-document-path"),
      ).toHaveTextContent(expected.relative_path);
      expect(
        within(section).getByTestId("identity-document-purpose"),
      ).toHaveTextContent(expected.purpose);
    });
    expect(screen.getByTestId("identity-directory")).toHaveTextContent(
      IDENTITY_DIRECTORY,
    );
  });

  it("says which documents have nothing written yet", async () => {
    renderPage();

    await screen.findByTestId("identity-documents-editor");
    expect(
      within(sectionFor("soul")).getByTestId("identity-document-status"),
    ).toHaveAttribute("data-exists", "true");
    const unwritten = within(sectionFor("style")).getByTestId(
      "identity-document-status",
    );
    expect(unwritten).toHaveAttribute("data-exists", "false");
    expect(unwritten).toHaveTextContent(
      I18nKey.SETTINGS$IDENTITY_DOCUMENT_NOT_WRITTEN,
    );
    // Nothing is dirty yet, so there is nothing to save.
    expect(
      within(sectionFor("style")).getByTestId("identity-document-save-button"),
    ).toBeDisabled();
  });

  it("writes only the document that was edited", async () => {
    const written = "Short sentences. No exclamation marks.";
    vi.mocked(SoulService.saveIdentityDocument).mockResolvedValue(
      makeDocument(
        styleDocument.name,
        styleDocument.relative_path,
        styleDocument.purpose,
        `${written}\n`,
      ),
    );
    renderPage();

    await screen.findByTestId("identity-documents-editor");
    const style = sectionFor("style");
    fireEvent.change(within(style).getByTestId("identity-document-input"), {
      target: { value: written },
    });
    await act(async () => {
      fireEvent.click(
        within(style).getByTestId("identity-document-save-button"),
      );
    });

    expect(SoulService.saveIdentityDocument).toHaveBeenCalledExactlyOnceWith(
      "style",
      written,
    );
    expect(displaySuccessToast).toHaveBeenCalledWith(
      I18nKey.SETTINGS$SOUL_SAVED,
    );
    // The editor now reflects what the server stored, not the draft, and the
    // documents nobody edited are untouched.
    expect(
      within(sectionFor("style")).getByTestId("identity-document-input"),
    ).toHaveValue(`${written}\n`);
    expect(
      within(sectionFor("soul")).getByTestId("identity-document-input"),
    ).toHaveValue(soulDocument.content);
  });

  it("clears a written document that was emptied, and says that is what saving does", async () => {
    vi.mocked(SoulService.saveIdentityDocument).mockResolvedValue(
      makeDocument(
        soulDocument.name,
        soulDocument.relative_path,
        soulDocument.purpose,
      ),
    );
    renderPage();

    await screen.findByTestId("identity-documents-editor");
    const soul = sectionFor("soul");
    fireEvent.change(within(soul).getByTestId("identity-document-input"), {
      target: { value: "" },
    });

    // Emptying a written document is a clear, and is named one before the
    // button is pressed.
    expect(
      within(soul).getByTestId("identity-document-clear-note"),
    ).toHaveTextContent(I18nKey.SETTINGS$IDENTITY_DOCUMENT_CLEAR_NOTE);
    expect(
      within(soul).queryByTestId("identity-document-save-button"),
    ).not.toBeInTheDocument();
    fireEvent.click(within(soul).getByTestId("identity-document-clear-button"));
    expect(screen.getByTestId("confirmation-modal")).toHaveTextContent(
      I18nKey.SETTINGS$IDENTITY_DOCUMENT_CLEAR_CONFIRM,
    );
    expect(SoulService.saveIdentityDocument).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(
        within(screen.getByTestId("confirmation-modal")).getByTestId(
          "confirm-button",
        ),
      );
    });

    // Blank content is how the server is told to remove the file.
    expect(SoulService.saveIdentityDocument).toHaveBeenCalledExactlyOnceWith(
      "soul",
      "",
    );
    expect(displaySuccessToast).toHaveBeenCalledWith(
      I18nKey.SETTINGS$IDENTITY_DOCUMENT_CLEARED,
    );
    expect(
      within(sectionFor("soul")).getByTestId("identity-document-status"),
    ).toHaveAttribute("data-exists", "false");
  });

  it("refuses to save content past the length the server accepts", async () => {
    renderPage();

    await screen.findByTestId("identity-documents-editor");
    const style = sectionFor("style");
    const editor = within(style).getByTestId("identity-document-input");
    fireEvent.change(editor, {
      target: { value: "x".repeat(MAX_IDENTITY_DOCUMENT_LENGTH + 1) },
    });

    expect(
      within(style).getByTestId("identity-document-too-long"),
    ).toBeInTheDocument();
    expect(editor).toHaveAttribute("aria-invalid", "true");
    fireEvent.click(within(style).getByTestId("identity-document-save-button"));
    expect(SoulService.saveIdentityDocument).not.toHaveBeenCalled();
  });

  it("explains an agent server without the route instead of failing", async () => {
    vi.mocked(SoulService.getIdentityDocuments).mockRejectedValue(
      new SoulUnsupportedError("missing-api"),
    );
    renderPage();

    const unsupported = await screen.findByTestId("soul-unsupported");
    expect(unsupported).toHaveAttribute("data-reason", "missing-api");
    expect(unsupported).toHaveTextContent(
      I18nKey.SETTINGS$SOUL_UNSUPPORTED_MISSING_API,
    );
    expect(
      screen.queryByTestId("identity-document-section"),
    ).not.toBeInTheDocument();
  });

  it("never asks a cloud backend, which has no identity documents", async () => {
    setRegisteredBackends([localBackend, cloudBackend]);
    setActiveSelection({ backendId: cloudBackend.id });
    renderPage();

    const unsupported = await screen.findByTestId("soul-unsupported");
    expect(unsupported).toHaveAttribute("data-reason", "cloud-backend");
    expect(SoulService.getIdentityDocuments).not.toHaveBeenCalled();
  });
});
