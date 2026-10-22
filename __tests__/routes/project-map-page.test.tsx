import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test-utils";
import MapRoute from "#/routes/map";
import ProjectMapService from "#/api/project-map-service/project-map-service.api";
import {
  setActiveSelection,
  setRegisteredBackends,
} from "#/api/backend-registry/active-store";
import type { Backend } from "#/api/backend-registry/types";
import { useProjectMapStore } from "#/stores/project-map-store";
import { PROJECT_MAP_FILE_PATH, PROJECT_MAP_VERSION } from "#/types/project-map";

const launchConversation = vi.hoisted(() => vi.fn());

/**
 * The shared test i18n instance carries no resources, so `t()` returns the key
 * and no interpolation happens. This page's header has to show the commit the
 * map was generated against, which is only observable once the real English
 * copy resolves — so the copy is read from the translation file rather than
 * restated here.
 */
vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  const translations = (await import("#/i18n/translation.json")) as unknown as {
    default: Record<string, Record<string, string>>;
  };
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, options?: Record<string, unknown>) =>
        (translations.default[key]?.en ?? key).replace(
          /\{\{(\w+)\}\}/g,
          (_match: string, name: string) => String(options?.[name] ?? ""),
        ),
      i18n: { language: "en" },
    }),
  };
});

// The conversation launcher is the underlying service behind
// `useCreateConversation`; mocking it keeps the real mutation, its pending
// state and its result handling in the test.
vi.mock("#/hooks/mutation/resolve-conversation-launch", () => ({
  launchConversation: launchConversation,
}));

const localBackend: Backend = {
  id: "local-test",
  name: "Local test backend",
  host: "http://localhost:3000",
  apiKey: "test-session-key",
  kind: "local",
};

const ABSOLUTE_PATH = `/home/agent/workspace/project/${PROJECT_MAP_FILE_PATH}`;

function mapFile(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: PROJECT_MAP_VERSION,
    commit: "abc1234",
    groups: [{ id: "web", label: "Web app", accent: "1" }],
    nodes: [
      {
        id: "src/routes/home.tsx",
        kind: "route",
        label: "home",
        path: "src/routes/home.tsx",
        group: "web",
        summary: "Landing page and launcher.",
        size: 420,
        x: 0,
        y: 0,
      },
      {
        id: "src/stores/events.ts",
        kind: "store",
        label: "events",
        path: "src/stores/events.ts",
        group: "web",
        summary: "Every event the agent emitted.",
        size: 300,
        x: 400,
        y: 0,
      },
    ],
    edges: [
      {
        from: "src/routes/home.tsx",
        to: "src/stores/events.ts",
        kind: "reads",
      },
    ],
    ...overrides,
  });
}

describe("the project map page", () => {
  beforeEach(() => {
    launchConversation.mockReset();
    launchConversation.mockResolvedValue({
      app_conversation_id: "conversation-1",
      agent_server_url: null,
    });
    useProjectMapStore.getState().reset();
    setRegisteredBackends([localBackend]);
    setActiveSelection({ backendId: localBackend.id });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useProjectMapStore.getState().reset();
    setActiveSelection(null);
    setRegisteredBackends([]);
  });

  it("offers to generate the map when the repository has none", async () => {
    // Arrange
    vi.spyOn(ProjectMapService, "readProjectMap").mockResolvedValue({
      absolutePath: ABSOLUTE_PATH,
      raw: null,
    });
    const user = userEvent.setup();
    renderWithProviders(<MapRoute />, { navigation: { currentPath: "/map" } });

    // Act
    const generate = await screen.findByTestId("project-map-generate");
    await user.click(generate);

    // Assert: the analysis runs as a conversation, because generating the map
    // means reading the repository.
    await waitFor(() => {
      expect(launchConversation).toHaveBeenCalledTimes(1);
    });
    const [, options] = launchConversation.mock.calls[0] as [
      unknown,
      { initialUserMsg?: string },
    ];
    expect(options.initialUserMsg).toContain(PROJECT_MAP_FILE_PATH);
    expect(options.initialUserMsg).toContain(
      "Preserve everything the user decided",
    );
  });

  it("explains a malformed document instead of rendering a blank canvas", async () => {
    // Arrange
    vi.spyOn(ProjectMapService, "readProjectMap").mockResolvedValue({
      absolutePath: ABSOLUTE_PATH,
      raw: "{ this is not json",
    });

    // Act
    renderWithProviders(<MapRoute />, { navigation: { currentPath: "/map" } });

    // Assert
    expect(await screen.findByTestId("project-map-invalid")).toBeInTheDocument();
    expect(screen.queryByTestId("project-map-canvas")).toBeNull();
  });

  it("draws the map and shows which commit it was generated against", async () => {
    // Arrange
    vi.spyOn(ProjectMapService, "readProjectMap").mockResolvedValue({
      absolutePath: ABSOLUTE_PATH,
      raw: mapFile(),
    });

    // Act
    renderWithProviders(<MapRoute />, { navigation: { currentPath: "/map" } });

    // Assert
    expect(await screen.findByTestId("project-map-canvas")).toBeInTheDocument();
    expect(screen.getByTestId("project-map-provenance")).toHaveTextContent("abc1234");
  });

  it("puts the selection in removable chips and in the exact text it will send", async () => {
    // Arrange
    vi.spyOn(ProjectMapService, "readProjectMap").mockResolvedValue({
      absolutePath: ABSOLUTE_PATH,
      raw: mapFile(),
    });
    const user = userEvent.setup();
    renderWithProviders(<MapRoute />, { navigation: { currentPath: "/map" } });
    await screen.findByTestId("project-map-canvas");

    // Act
    await user.click(screen.getByTestId("project-map-node-src/stores/events.ts"));

    // Assert: the chip names it, and the preview is the real message body.
    expect(screen.getByTestId("project-map-selection-chips")).toHaveTextContent("events");
    const preview = screen.getByTestId("project-map-context-preview");
    expect(preview).toHaveTextContent('store "events" (src/stores/events.ts)');
    expect(preview).toHaveTextContent("generated against abc1234");

    // Act: typing a question puts it ahead of the context block.
    await user.type(screen.getByTestId("project-map-composer"), "why is this slow?");

    // Assert
    expect(preview.textContent?.startsWith("why is this slow?")).toBe(true);

    // Act: sending launches a conversation carrying exactly that text.
    await user.click(screen.getByTestId("project-map-send"));

    // Assert
    await waitFor(() => {
      expect(launchConversation).toHaveBeenCalledTimes(1);
    });
    const [, options] = launchConversation.mock.calls[0] as [
      unknown,
      { initialUserMsg?: string },
    ];
    expect(options.initialUserMsg).toBe(preview.textContent);
  });

  it("keeps unsaved moves when a regenerated file arrives under them", async () => {
    // Arrange: the page is open with an edit in hand.
    const read = vi
      .spyOn(ProjectMapService, "readProjectMap")
      .mockResolvedValue({ absolutePath: ABSOLUTE_PATH, raw: mapFile() });
    const user = userEvent.setup();
    renderWithProviders(<MapRoute />, { navigation: { currentPath: "/map" } });
    await screen.findByTestId("project-map-canvas");
    await user.click(screen.getByTestId("project-map-node-src/routes/home.tsx"));
    await user.click(screen.getByTestId("project-map-toggle-hidden"));

    // Act: the agent regenerates against a new commit, moving that node and
    // dropping the other one, and the user re-reads the file.
    read.mockResolvedValue({
      absolutePath: ABSOLUTE_PATH,
      raw: mapFile({
        commit: "feed9999",
        nodes: [
          {
            id: "src/routes/home.tsx",
            kind: "route",
            label: "home",
            path: "src/routes/home.tsx",
            group: "web",
            summary: "Now also launches automations.",
            size: 520,
            x: 999,
            y: 999,
          },
        ],
        edges: [],
      }),
    });
    await user.click(screen.getByTestId("project-map-refresh"));

    // Assert: the new analysis wins on facts, the user's decision survives.
    await waitFor(() => {
      expect(screen.getByTestId("project-map-provenance")).toHaveTextContent(
        "feed9999",
      );
    });
    const open = useProjectMapStore.getState().document;
    const home = open?.nodes.find((node) => node.id === "src/routes/home.tsx");
    expect(home).toMatchObject({
      hidden: true,
      summary: "Now also launches automations.",
      x: 0,
      y: 0,
    });
  });

  it("writes the arrangement back only when the user saves it", async () => {
    // Arrange
    vi.spyOn(ProjectMapService, "readProjectMap").mockResolvedValue({
      absolutePath: ABSOLUTE_PATH,
      raw: mapFile(),
    });
    const write = vi
      .spyOn(ProjectMapService, "writeProjectMap")
      .mockResolvedValue(ABSOLUTE_PATH);
    const user = userEvent.setup();
    renderWithProviders(<MapRoute />, { navigation: { currentPath: "/map" } });
    await screen.findByTestId("project-map-canvas");

    // Assert: nothing is written just for opening the page.
    expect(screen.getByTestId("project-map-save")).toBeDisabled();
    expect(write).not.toHaveBeenCalled();

    // Act: hide a node, which is an edit.
    await user.click(screen.getByTestId("project-map-node-src/routes/home.tsx"));
    await user.click(screen.getByTestId("project-map-toggle-hidden"));

    // Assert
    expect(screen.getByTestId("project-map-unsaved")).toBeInTheDocument();

    // Act
    await user.click(screen.getByTestId("project-map-save"));

    // Assert: the saved document carries the edit, with the node still present
    // so the agent can see it was deliberately hidden.
    await waitFor(() => {
      expect(write).toHaveBeenCalledTimes(1);
    });
    const [raw] = write.mock.calls[0] as [string];
    expect(JSON.parse(raw)).toMatchObject({
      nodes: expect.arrayContaining([
        expect.objectContaining({ id: "src/routes/home.tsx", hidden: true }),
      ]),
    });
  });
});
