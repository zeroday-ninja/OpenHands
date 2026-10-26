import React from "react";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test-utils";
import { featureTrialsOn } from "#/features/feature-trials";
import { useFeatureTrialStore } from "#/stores/feature-trial-store";

/**
 * Chat is behind a dock now: the canvas is the work, and a panel over it is
 * something you open. Everything below that talks to the agent opens it first,
 * the way a person would.
 */
async function openChat() {
  const toggle = await screen.findByTestId("project-map-chat-dock-toggle");
  // Fired rather than typed: a second `userEvent.setup()` inside a test that
  // already has one fights the first over pointer state, and opening a panel
  // is not the behaviour any of these tests are about.
  if (toggle.getAttribute("aria-expanded") !== "true") fireEvent.click(toggle);
  // The panel is lazily imported, and the first test in a file to open it pays
  // for the import — which is longer than the default wait.
  //
  // Fifteen seconds rather than five. Five was enough on an idle machine and
  // not on a loaded one: this file failed intermittently at exactly 5100ms on
  // "Unable to find project-map-composer", while every other case passed and
  // the same file passed on its own minutes earlier. A timeout tuned to a
  // quiet machine turns a full run into something a reader has to re-run
  // before believing, which costs more than the wait it saves — and the
  // waiting only happens on the one import, not per test.
  await screen.findByTestId("project-map-composer", undefined, {
    timeout: 15000,
  });
}
import MapRoute from "#/routes/map";
import { http, HttpResponse } from "msw";
import { server } from "#/mocks/node";
import { clearCachedAgentServerInfo } from "#/api/agent-server-compatibility";
import ProjectMapService, {
  ProjectMapReadError,
  ProjectMapRuntimeUnavailableError,
} from "#/api/project-map-service/project-map-service.api";
import translations from "#/i18n/translation.json";
import { ActiveBackendProvider } from "#/contexts/active-backend-context";
import { displayErrorToast } from "#/utils/custom-toast-handlers";
import {
  setActiveSelection,
  setRegisteredBackends,
} from "#/api/backend-registry/active-store";
import type { Backend } from "#/api/backend-registry/types";
import { useProjectMapStore } from "#/stores/project-map-store";
import { useProjectMapWorkspaceStore } from "#/stores/project-map-workspace-store";
import WorkspacesService from "#/api/workspaces-service/workspaces-service.api";
import { useEventStore } from "#/stores/use-event-store";
import {
  SecurityRisk,
  type ACPToolCallEvent,
  type ActionEvent,
  type MessageEvent,
  type ObservationEvent,
} from "#/types/agent-server/core";
import {
  PROJECT_MAP_FILE_PATH,
  PROJECT_MAP_VERSION,
} from "#/types/project-map";

const launchConversation = vi.hoisted(() => vi.fn());
/** The live work graph, empty unless a case puts work on it. */
const workGraphNodes = vi.hoisted(() => ({ current: [] as unknown[] }));

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

// The live work graph is assembled from every backend's answer; the page's
// own job is what it does with the result, so the fetch is the stub.
vi.mock("#/hooks/query/use-work-graph", () => ({
  useWorkGraph: () => ({
    graph: {
      nodes: workGraphNodes.current,
      edges: [],
      omissions: [],
      findings: [],
      inFlight: 0,
      generatedAt: null,
    },
    contributions: [],
    isPending: false,
    isFetching: false,
  }),
}));

// The pane's conversation transport. Stubbed as a pass-through so these cases
// exercise the page's binding, rendering and refresh rather than a WebSocket:
// the same stubs the conversation route's own tests use.
vi.mock("#/contexts/websocket-provider-wrapper", () => ({
  WebSocketProviderWrapper: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("#/wrapper/event-handler", () => ({
  EventHandler: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

// No `Toaster` is mounted in these renders, so the toast is observed where it
// is raised rather than where it would be drawn.
vi.mock("#/utils/custom-toast-handlers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#/utils/custom-toast-handlers")>()),
  displayErrorToast: vi.fn(),
}));

/** The English copy of a key, read from the file rather than restated here. */
function copy(key: string): string {
  return (translations as unknown as Record<string, Record<string, string>>)[
    key
  ].en;
}

const localBackend: Backend = {
  id: "local-test",
  name: "Local test backend",
  host: "http://localhost:3000",
  apiKey: "test-session-key",
  kind: "local",
};

const ABSOLUTE_PATH = `/home/agent/workspace/project/${PROJECT_MAP_FILE_PATH}`;

/** The backend's own working directory: what an unbound page reads. */
const HOST_WORKSPACE = {
  conversationId: null,
  workingDir: "/home/agent/workspace/project",
};

/** A conversation's sandbox, which is a different filesystem entirely. */
const SANDBOX_WORKSPACE = {
  conversationId: "conversation-1",
  workingDir: "/workspace",
};
const SANDBOX_PATH = `/workspace/${PROJECT_MAP_FILE_PATH}`;

/** A map-less read of whichever workspace the page aimed at. */
function emptyRead(target?: { conversationId?: string | null } | undefined) {
  return target?.conversationId
    ? { workspace: SANDBOX_WORKSPACE, absolutePath: SANDBOX_PATH, raw: null }
    : { workspace: HOST_WORKSPACE, absolutePath: ABSOLUTE_PATH, raw: null };
}

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

/** An agent answer, as it arrives in the event store. */
function agentAnswer(text: string): MessageEvent {
  return {
    id: "answer-1",
    timestamp: "2024-01-01T00:00:01Z",
    source: "agent",
    llm_message: { role: "assistant", content: [{ type: "text", text }] },
    activated_skills: [],
    extended_content: [],
  };
}

/**
 * An ACP agent's answer: Claude Code, Codex and the rest end a turn with a
 * finish action carrying the reply rather than with an assistant message.
 */
function finishAction(text: string): ActionEvent {
  return {
    id: "finish-1",
    timestamp: "2024-01-01T00:00:03Z",
    source: "agent",
    thought: [],
    thinking_blocks: [],
    action: { kind: "FinishAction", message: text },
    tool_name: "finish",
    tool_call_id: "call-finish",
    tool_call: {
      id: "call-finish",
      type: "function",
      function: { name: "finish", arguments: "{}" },
    },
    llm_response_id: "response-1",
    security_risk: SecurityRisk.UNKNOWN,
  };
}

/**
 * An ACP agent reporting that it rewrote a file. Claude Code, Codex and the
 * rest never emit the OpenHands file-editor observation below.
 */
function acpFileEdit(path: string): ACPToolCallEvent {
  return {
    id: "acp-edit-1",
    timestamp: "2024-01-01T00:00:02Z",
    source: "agent",
    kind: "ACPToolCallEvent",
    tool_call_id: "call-acp-edit",
    title: `Edit ${path}`,
    status: "completed",
    tool_kind: "edit",
    raw_input: { file_path: path },
    raw_output: "updated",
    content: null,
    is_error: false,
  };
}

/** The agent reporting that it just rewrote a file. */
function fileEdit(path: string): ObservationEvent {
  return {
    id: "edit-1",
    timestamp: "2024-01-01T00:00:02Z",
    source: "environment",
    tool_name: "file_editor",
    tool_call_id: "call-1",
    action_id: "action-1",
    observation: {
      kind: "FileEditorObservation",
      content: [{ type: "text", text: "edited" }],
      command: "str_replace",
      output: "edited",
      path,
      prev_exist: true,
      old_content: null,
      new_content: null,
      error: null,
    },
  };
}

const cloudBackend: Backend = {
  id: "cloud-test",
  name: "Cloud test backend",
  host: "https://app.all-hands.dev",
  apiKey: "cloud-key",
  kind: "cloud",
};

describe("the project map page", () => {
  beforeEach(() => {
    vi.mocked(displayErrorToast).mockClear();
    launchConversation.mockReset();
    launchConversation.mockResolvedValue({
      app_conversation_id: "conversation-1",
      agent_server_url: null,
    });
    useProjectMapStore.getState().reset();
    useEventStore.getState().clearEvents();
    // The folder a page was pointed at is remembered across reloads, so each
    // case starts with none chosen.
    window.localStorage.clear();
    useProjectMapWorkspaceStore.setState({ selectionByBackendId: {} });
    // The repository picker lists saved workspaces and, in dev builds, the
    // children of an implicit `/projects` parent. Answered here so no case
    // reaches past MSW to whatever is listening on the test backend's port.
    server.use(
      http.get(`${localBackend.host}/api/file/search_subdirs`, () =>
        HttpResponse.json({ items: [], next_page_id: null }),
      ),
    );
    setRegisteredBackends([localBackend]);
    setActiveSelection({ backendId: localBackend.id });
  });

  afterEach(() => {
    // The binding outlives the page by design — a launch that settles after
    // the user has moved on is still remembered — so every case that starts a
    // conversation waits for it to be bound before ending, or the next case
    // inherits a conversation it never started.
    useProjectMapWorkspaceStore.setState({ selectionByBackendId: {} });
    window.localStorage.clear();
    vi.restoreAllMocks();
    useEventStore.getState().clearEvents();
    useProjectMapStore.getState().reset();
    useFeatureTrialStore.setState({ records: {} });
    setActiveSelection(null);
    setRegisteredBackends([]);
  });

  it("offers to generate the map when the repository has none", async () => {
    // Arrange
    const read = vi
      .spyOn(ProjectMapService, "readProjectMap")
      .mockImplementation(async (target) => emptyRead(target));
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
      { initialUserMsg?: string; workingDirOverride?: string },
    ];
    expect(options.initialUserMsg).toContain(PROJECT_MAP_FILE_PATH);
    expect(options.initialUserMsg).toContain(
      "Preserve everything the user decided",
    );
    // On a host workspace the conversation joins the directory the page reads
    // and is told that file's absolute path, so both ends edit one file.
    expect(options.initialUserMsg).toContain(ABSOLUTE_PATH);
    expect(options.workingDirOverride).toBe(HOST_WORKSPACE.workingDir);

    // Assert: the page keeps the conversation rather than navigating to it,
    // and now reads the workspace that conversation is writing in.
    await waitFor(() => {
      expect(read).toHaveBeenCalledWith(
        expect.objectContaining({ conversationId: "conversation-1" }),
      );
    });
    expect(
      await screen.findByTestId("project-map-analysis-running"),
    ).toHaveTextContent(SANDBOX_WORKSPACE.workingDir);
    expect(screen.getByTestId("project-map-workspace")).toHaveAttribute(
      "data-conversation-id",
      "conversation-1",
    );

    // Act: a write the agent did not report — a shell redirect, say — is
    // picked up when the user asks, without a reload that would drop the
    // binding and send the page back to the backend's own workspace.
    read.mockImplementation(async (target) =>
      target?.conversationId
        ? {
            workspace: SANDBOX_WORKSPACE,
            absolutePath: SANDBOX_PATH,
            raw: mapFile(),
          }
        : emptyRead(target),
    );
    await user.click(screen.getByTestId("project-map-empty-refresh"));

    // Assert: the drawing is the sandbox's, and the page says so.
    expect(await screen.findByTestId("project-map-canvas")).toBeInTheDocument();
    expect(screen.getByTestId("project-map-workspace")).toHaveTextContent(
      SANDBOX_WORKSPACE.workingDir,
    );
  });

  it("names the folder an unbound map was read from, once", async () => {
    // Arrange
    vi.spyOn(ProjectMapService, "readProjectMap").mockResolvedValue({
      workspace: HOST_WORKSPACE,
      absolutePath: ABSOLUTE_PATH,
      raw: mapFile(),
    });

    // Act
    renderWithProviders(
      <ActiveBackendProvider>
        <MapRoute />
      </ActiveBackendProvider>,
      { navigation: { currentPath: "/map" } },
    );

    // Assert: an empty or unexpected map is only readable as such when the
    // page says which folder it came from — which the picker does, with the
    // whole path on hover. Saying it twice read as two different things.
    const picker = await screen.findByTestId("project-map-workspace-picker");
    expect(picker).toHaveAttribute("data-path", HOST_WORKSPACE.workingDir);
    expect(picker).toHaveAttribute("title", HOST_WORKSPACE.workingDir);
    expect(screen.queryByTestId("project-map-workspace")).toBeNull();
  });

  it("tells the analysis to use its own workspace when conversations are isolated", async () => {
    // Arrange: a backend that gives every conversation its own container, so
    // the directory this page reads does not exist inside it.
    clearCachedAgentServerInfo();
    server.use(
      http.get(`${localBackend.host}/server_info`, () =>
        HttpResponse.json({
          version: "1.57.0",
          uptime: 0,
          idle_time: 0,
          conversation_runtime: "docker",
        }),
      ),
    );
    vi.spyOn(ProjectMapService, "readProjectMap").mockImplementation(
      async (target) => emptyRead(target),
    );
    const user = userEvent.setup();
    renderWithProviders(<MapRoute />, { navigation: { currentPath: "/map" } });

    // Act
    await user.click(await screen.findByTestId("project-map-generate"));

    // Assert: naming the page's absolute path would send the agent to a
    // directory its sandbox does not have, and attaching that directory is
    // rejected outright, so neither is sent.
    await waitFor(() => {
      expect(launchConversation).toHaveBeenCalledTimes(1);
    });
    const [, options] = launchConversation.mock.calls[0] as [
      unknown,
      { initialUserMsg?: string; workingDirOverride?: string },
    ];
    expect(options.initialUserMsg).toContain(PROJECT_MAP_FILE_PATH);
    expect(options.initialUserMsg).not.toContain(ABSOLUTE_PATH);
    expect(options.workingDirOverride).toBeUndefined();
    // And the page follows the conversation it started.
    await waitFor(() =>
      expect(
        screen.getByTestId("project-map-analysis-running"),
      ).toHaveTextContent("conversation-1"),
    );
  });

  it("explains a malformed document instead of rendering a blank canvas", async () => {
    // Arrange
    vi.spyOn(ProjectMapService, "readProjectMap").mockResolvedValue({
      workspace: HOST_WORKSPACE,
      absolutePath: ABSOLUTE_PATH,
      raw: "{ this is not json",
    });

    // Act
    renderWithProviders(<MapRoute />, { navigation: { currentPath: "/map" } });

    // Assert
    expect(
      await screen.findByTestId("project-map-invalid"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("project-map-canvas")).toBeNull();
  });

  it("offers a way out of a map that cannot be drawn, including the conversation that wrote it", async () => {
    // Arrange: the page generated a map, and what the agent wrote does not
    // parse. The chat dock only exists over a drawn canvas, so without this
    // the conversation that could fix the file in one turn was unreachable.
    const read = vi
      .spyOn(ProjectMapService, "readProjectMap")
      .mockImplementation(async (target) => emptyRead(target));
    const navigate = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<MapRoute />, {
      navigation: { currentPath: "/map", conversationId: null, navigate },
    });
    await user.click(await screen.findByTestId("project-map-generate"));
    await screen.findByTestId("project-map-analysis-running");
    read.mockResolvedValue({
      workspace: SANDBOX_WORKSPACE,
      absolutePath: SANDBOX_PATH,
      raw: JSON.stringify({
        version: PROJECT_MAP_VERSION,
        nodes: [],
        edges: [{ source: "a", target: "b", kind: "calls" }],
      }),
    });

    // Act: the file arrives, and the user re-reads it.
    await user.click(screen.getByTestId("project-map-empty-refresh"));

    // Assert: the complaint names the field, and the conversation is one click
    // away — as are re-reading and regenerating.
    await screen.findByTestId("project-map-invalid");
    expect(screen.getByTestId("project-map-invalid")).toHaveTextContent(
      "edges[0].from",
    );
    expect(
      screen.getByTestId("project-map-invalid-refresh"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("project-map-invalid-regenerate"),
    ).toBeInTheDocument();
    await user.click(
      screen.getByTestId("project-map-invalid-open-conversation"),
    );
    expect(navigate).toHaveBeenCalledWith("/conversations/conversation-1");
  });

  /** A map big enough to be a wall: three layers, fifteen parts each. */
  function bigMapFile() {
    const groups = ["web", "api", "data"];
    const nodes = groups.flatMap((group, g) =>
      Array.from({ length: 15 }, (_, i) => ({
        id: `src/${group}/${i}.ts`,
        kind: "module",
        label: `${group} ${i}`,
        path: `src/${group}/${i}.ts`,
        group,
        summary: "",
        size: 100,
        x: g * 260,
        y: i * 96,
      })),
    );
    return mapFile({
      groups: groups.map((id, i) => ({ id, label: id, accent: `${i + 1}` })),
      nodes,
      edges: [
        { from: "src/web/0.ts", to: "src/api/0.ts", kind: "calls" },
        { from: "src/api/1.ts", to: "src/data/0.ts", kind: "reads" },
      ],
    });
  }

  it("comes back as its layers after a detour through a repository with no map", async () => {
    // Arrange: two saved repositories; one has a big map, the other none.
    const OTHER = {
      id: "/home/agent/repos/other",
      name: "other",
      path: "/home/agent/repos/other",
    };
    saveWorkspaces([HAZARD, OTHER]);
    vi.spyOn(ProjectMapService, "readProjectMap").mockImplementation(
      async (target) => ({
        workspace: {
          conversationId: null,
          workingDir: target?.workingDir ?? HOST_WORKSPACE.workingDir,
        },
        absolutePath: `${target?.workingDir ?? HOST_WORKSPACE.workingDir}/${PROJECT_MAP_FILE_PATH}`,
        raw: target?.workingDir === HAZARD.path ? bigMapFile() : null,
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<MapRoute />, { navigation: { currentPath: "/map" } });
    await screen.findByTestId("project-map-empty");
    await chooseRepository(user, "hazard");
    await screen.findByTestId("project-map-overview");

    // Act: away to a repository with no map, and back.
    await chooseRepository(user, "other");
    await screen.findByTestId("project-map-empty");
    await chooseRepository(user, "hazard");

    // Assert: the layers again, not the wall — "I clicked another repo and
    // now my map is gone".
    await screen.findByTestId("project-map-overview");
    expect(screen.getByTestId("project-map-view-overview")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("opens a big map as its layers, and a small one in full", async () => {
    // Arrange: forty-five parts in three layers.
    vi.spyOn(ProjectMapService, "readProjectMap").mockResolvedValue({
      workspace: HOST_WORKSPACE,
      absolutePath: ABSOLUTE_PATH,
      raw: bigMapFile(),
    });
    const user = userEvent.setup();
    const { unmount } = renderWithProviders(<MapRoute />, {
      navigation: { currentPath: "/map" },
    });

    // Assert: blocks with counts, not forty-five plates.
    await screen.findByTestId("project-map-overview");
    expect(
      screen.getByTestId("project-map-overview-block-web"),
    ).toHaveAttribute("data-count", "15");
    expect(screen.queryByTestId("project-map-node-src/web/0.ts")).toBeNull();
    expect(screen.getByTestId("project-map-view-overview")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    // And what the blocks are is said on the paper, not only in a card.
    expect(screen.getByTestId("project-map-overview-hint")).toHaveTextContent(
      copy("PROJECT_MAP$OVERVIEW_HINT"),
    );

    // Act: ask for the whole drawing.
    await user.click(screen.getByTestId("project-map-view-details"));

    // Assert: the drawing, with the way back up on it; the drawing tools
    // stay out of the way in the analysis mode the map opens in.
    expect(screen.queryByTestId("project-map-overview")).toBeNull();
    expect(
      screen.getByTestId("project-map-node-src/web/0.ts"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("project-map-tool-box")).toBeNull();
    expect(screen.queryByTestId("project-map-overview-hint")).toBeNull();
    await user.click(screen.getByTestId("project-map-all-layers"));
    expect(screen.getByTestId("project-map-overview")).toBeInTheDocument();
    expect(screen.queryByTestId("project-map-all-layers")).toBeNull();
    unmount();

    // A small map has nothing to fold and opens in full, switch and all.
    vi.spyOn(ProjectMapService, "readProjectMap").mockResolvedValue({
      workspace: HOST_WORKSPACE,
      absolutePath: ABSOLUTE_PATH,
      raw: mapFile(),
    });
    renderWithProviders(<MapRoute />, { navigation: { currentPath: "/map" } });
    await screen.findByTestId("project-map-canvas");
    expect(screen.queryByTestId("project-map-overview")).toBeNull();
    expect(
      screen.getByTestId("project-map-node-src/routes/home.tsx"),
    ).toBeInTheDocument();
  });

  /** Nothing new to introduce, so the rail has nothing it must show. */
  function everythingAnnounced() {
    featureTrialsOn("/map").forEach((trial) =>
      useFeatureTrialStore.getState().markAnnounced(trial.id),
    );
  }

  it("gives the map the width once its features have introduced themselves", async () => {
    // Arrange
    everythingAnnounced();
    vi.spyOn(ProjectMapService, "readProjectMap").mockResolvedValue({
      workspace: HOST_WORKSPACE,
      absolutePath: ABSOLUTE_PATH,
      raw: mapFile(),
    });
    const user = userEvent.setup();

    // Act
    renderWithProviders(<MapRoute />, { navigation: { currentPath: "/map" } });
    await screen.findByTestId("project-map-canvas");

    // Assert: the rail is folded, and the toolbar says it can be opened.
    expect(screen.queryByTestId("project-map-legend")).toBeNull();
    const toggle = screen.getByTestId("project-map-rail-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(screen.getByTestId("project-map-legend")).toBeInTheDocument();
  });

  it("shows the conversation it started when the map is rebuilt", async () => {
    // Arrange: a drawn map, rebuilt. Reading it again through the new
    // conversation puts the loading notice over the canvas, which unmounts
    // the dock — the press that starts the work must still show it.
    everythingAnnounced();
    vi.spyOn(ProjectMapService, "readProjectMap").mockResolvedValue({
      workspace: HOST_WORKSPACE,
      absolutePath: ABSOLUTE_PATH,
      raw: mapFile(),
    });
    const user = userEvent.setup();
    renderWithProviders(<MapRoute />, { navigation: { currentPath: "/map" } });
    await screen.findByTestId("project-map-canvas");
    expect(screen.getByTestId("project-map-chat-dock")).toHaveAttribute(
      "data-open",
      "false",
    );

    // Act
    await user.click(screen.getByTestId("project-map-regenerate"));

    // Assert
    await waitFor(() =>
      expect(screen.getByTestId("project-map-chat-dock")).toHaveAttribute(
        "data-open",
        "true",
      ),
    );
  });

  it("shows an agent's transcript when you click it on the work layer", async () => {
    // Arrange: one agent at work, with the conversation that is doing it.
    everythingAnnounced();
    workGraphNodes.current = [
      {
        key: "oh:1/local/agent:a1",
        kind: "agent",
        label: "codex",
        status: "in_flight",
        attrs: { role: "builder", conversation_id: "conversation-1" },
      },
    ];
    vi.spyOn(ProjectMapService, "readProjectMap").mockResolvedValue({
      workspace: HOST_WORKSPACE,
      absolutePath: ABSOLUTE_PATH,
      raw: mapFile(),
    });
    renderWithProviders(<MapRoute />, { navigation: { currentPath: "/map" } });
    await screen.findByTestId("project-map-canvas");

    // Act: look at what the agents are doing, and click one.
    act(() => useProjectMapStore.getState().setLayer("work"));
    await screen.findByTestId("project-map-node-oh:1/local/agent:a1");
    act(() =>
      useProjectMapStore.getState().setSelection(["oh:1/local/agent:a1"]),
    );

    // Assert: the transcript is the whole point of drawing the agent, and
    // binding it remounts the dock under the socket providers — so the page
    // opens it rather than leaving the dock to notice a change it cannot see.
    await waitFor(() =>
      expect(screen.getByTestId("project-map-chat-dock")).toHaveAttribute(
        "data-open",
        "true",
      ),
    );
  });

  it("says on the paper what a plate and a line are", async () => {
    // Arrange: a map small enough to open in full, so the detail view is
    // what a first visit lands on.
    everythingAnnounced();
    vi.spyOn(ProjectMapService, "readProjectMap").mockResolvedValue({
      workspace: HOST_WORKSPACE,
      absolutePath: ABSOLUTE_PATH,
      raw: mapFile(),
    });

    // Act
    renderWithProviders(<MapRoute />, { navigation: { currentPath: "/map" } });
    await screen.findByTestId("project-map-canvas");

    // Assert: the key is in the rail, which is folded by default, so the
    // paper carries the sentence a newcomer needs instead.
    expect(screen.getByTestId("project-map-detail-hint")).toHaveTextContent(
      copy("PROJECT_MAP$DETAIL_HINT"),
    );
    expect(screen.queryByTestId("project-map-legend")).toBeNull();
  });

  it("opens on the agents when the link asks for them", async () => {
    // Arrange: a screen about what the agents are doing links here, and the
    // drawing of that work is the point of the link.
    everythingAnnounced();
    workGraphNodes.current = [
      {
        key: "oh:1/local/agent:a1",
        kind: "agent",
        label: "codex",
        status: "in_flight",
        attrs: { role: "builder", conversation_id: "conversation-1" },
      },
    ];
    vi.spyOn(ProjectMapService, "readProjectMap").mockResolvedValue({
      workspace: HOST_WORKSPACE,
      absolutePath: ABSOLUTE_PATH,
      raw: mapFile(),
    });

    // Act
    renderWithProviders(<MapRoute />, {
      navigation: { currentPath: "/map?layer=work" },
    });

    // Assert: the work layer is on the paper, without a press.
    expect(
      await screen.findByTestId("project-map-node-oh:1/local/agent:a1"),
    ).toBeInTheDocument();
    expect(useProjectMapStore.getState().layer).toBe("work");
  });

  it("lands on the agent a transcript came from", async () => {
    // Arrange: the conversation page links here with its own id, asking the
    // map where that work sits.
    everythingAnnounced();
    workGraphNodes.current = [
      {
        key: "oh:1/local/agent:a1",
        kind: "agent",
        label: "codex",
        status: "in_flight",
        attrs: { role: "builder", conversation_id: "conversation-1" },
      },
    ];
    vi.spyOn(ProjectMapService, "readProjectMap").mockResolvedValue({
      workspace: HOST_WORKSPACE,
      absolutePath: ABSOLUTE_PATH,
      raw: mapFile(),
    });

    // Act
    renderWithProviders(<MapRoute />, {
      navigation: {
        currentPath: "/map?layer=work&conversation=conversation-1",
      },
    });
    await screen.findByTestId("project-map-node-oh:1/local/agent:a1");

    // Assert: that agent is the selection, so the rail describes it and the
    // dock shows what it is doing.
    await waitFor(() =>
      expect(useProjectMapStore.getState().selection).toEqual([
        "oh:1/local/agent:a1",
      ]),
    );
  });

  it("opens the rail for the part you click", async () => {
    // Arrange
    everythingAnnounced();
    vi.spyOn(ProjectMapService, "readProjectMap").mockResolvedValue({
      workspace: HOST_WORKSPACE,
      absolutePath: ABSOLUTE_PATH,
      raw: mapFile(),
    });
    const user = userEvent.setup();
    renderWithProviders(<MapRoute />, { navigation: { currentPath: "/map" } });
    await screen.findByTestId("project-map-canvas");

    // Act: a selection is a question about one part, which the rail answers.
    await user.click(
      screen.getByTestId("project-map-node-src/routes/home.tsx"),
    );

    // Assert
    expect(screen.getByTestId("project-map-inspector")).toBeInTheDocument();
  });

  it("draws the map and says which commit it came from, and when", async () => {
    // Arrange
    vi.spyOn(ProjectMapService, "readProjectMap").mockResolvedValue({
      workspace: HOST_WORKSPACE,
      absolutePath: ABSOLUTE_PATH,
      raw: mapFile({
        generated_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
      }),
    });

    // Act
    renderWithProviders(<MapRoute />, { navigation: { currentPath: "/map" } });

    // Assert
    expect(await screen.findByTestId("project-map-canvas")).toBeInTheDocument();
    const provenance = screen.getByTestId("project-map-provenance");
    expect(provenance).toHaveTextContent("abc1234");
    expect(provenance).toHaveTextContent(/ago/);
    // The controls say what they do, and the key is open without a click.
    expect(screen.getByTestId("project-map-regenerate")).toHaveAttribute(
      "title",
    );
    expect(screen.getByTestId("project-map-legend")).toHaveAttribute("open");
    expect(
      await screen.findByTestId("project-map-chat-dock-toggle"),
    ).toHaveAttribute("title");
    // Nothing was chosen, so the picker names the folder the map was read
    // from rather than asking beside a map it is already showing.
    expect(screen.getByTestId("project-map-workspace-picker")).toHaveAttribute(
      "data-path",
      HOST_WORKSPACE.workingDir,
    );
  });

  it("frames the whole map when the page opens", async () => {
    // Arrange: a map placed far from the origin, so the initial viewport
    // cannot happen to contain it.
    vi.spyOn(ProjectMapService, "readProjectMap").mockResolvedValue({
      workspace: HOST_WORKSPACE,
      absolutePath: ABSOLUTE_PATH,
      raw: mapFile({
        nodes: [
          {
            id: "a",
            kind: "route",
            label: "a",
            path: "a.tsx",
            group: "web",
            summary: "",
            size: 100,
            x: 1200,
            y: 900,
          },
          {
            id: "b",
            kind: "service",
            label: "b",
            path: "b.ts",
            group: "web",
            summary: "",
            size: 100,
            x: 2000,
            y: 1400,
          },
        ],
        edges: [],
      }),
    });
    const FRAME = { width: 900, height: 600 };
    vi.spyOn(SVGElement.prototype, "getBoundingClientRect").mockReturnValue({
      ...FRAME,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: FRAME.width,
      bottom: FRAME.height,
      toJSON: () => ({}),
    } as DOMRect);

    // Act
    renderWithProviders(<MapRoute />, { navigation: { currentPath: "/map" } });
    await screen.findByTestId("project-map-canvas");

    // Assert: both nodes fall inside the visible region. A map that opens
    // part-way off the canvas reads as broken before anyone touches it.
    await waitFor(() => {
      const { viewport } = useProjectMapStore.getState();
      expect(viewport.x).toBeLessThanOrEqual(1200);
      expect(viewport.y).toBeLessThanOrEqual(900);
      expect(viewport.x + FRAME.width / viewport.scale).toBeGreaterThanOrEqual(
        2000,
      );
      expect(viewport.y + FRAME.height / viewport.scale).toBeGreaterThanOrEqual(
        1400,
      );
    });
  });

  it("puts the selection in removable chips and in the exact text it will send", async () => {
    // Arrange
    vi.spyOn(ProjectMapService, "readProjectMap").mockResolvedValue({
      workspace: HOST_WORKSPACE,
      absolutePath: ABSOLUTE_PATH,
      raw: mapFile(),
    });
    const user = userEvent.setup();
    renderWithProviders(<MapRoute />, { navigation: { currentPath: "/map" } });
    await screen.findByTestId("project-map-canvas");
    await openChat();

    // Act
    await user.click(
      screen.getByTestId("project-map-node-src/stores/events.ts"),
    );

    // Assert: the chip names it, and the preview is the real message body.
    expect(screen.getByTestId("project-map-selection-chips")).toHaveTextContent(
      "events",
    );
    const preview = screen.getByTestId("project-map-context-preview");
    expect(preview).toHaveTextContent('store "events" (src/stores/events.ts)');
    expect(preview).toHaveTextContent("generated against abc1234");

    // Act: typing a question puts it ahead of the context block.
    await user.type(
      screen.getByTestId("project-map-composer"),
      "why is this slow?",
    );

    // Assert
    expect(preview.textContent?.startsWith("why is this slow?")).toBe(true);

    // What the user was shown, read before sending: a successful send clears
    // the composer, so reading it afterwards would be reading a different
    // message than the one that went.
    const shown = preview.textContent;

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
    expect(options.initialUserMsg).toBe(shown);
    await waitFor(() =>
      expect(screen.getByTestId("project-map-conversation")).toHaveAttribute(
        "data-conversation-id",
        "conversation-1",
      ),
    );
  });

  it("keeps unsaved moves when a regenerated file arrives under them", async () => {
    // Arrange: the page is open with an edit in hand.
    const read = vi
      .spyOn(ProjectMapService, "readProjectMap")
      .mockResolvedValue({
        workspace: HOST_WORKSPACE,
        absolutePath: ABSOLUTE_PATH,
        raw: mapFile(),
      });
    const user = userEvent.setup();
    renderWithProviders(<MapRoute />, { navigation: { currentPath: "/map" } });
    await screen.findByTestId("project-map-canvas");
    await user.click(
      screen.getByTestId("project-map-node-src/routes/home.tsx"),
    );
    await user.click(screen.getByTestId("project-map-toggle-hidden"));

    // Act: the agent regenerates against a new commit, moving that node and
    // dropping the other one, and the user re-reads the file.
    read.mockResolvedValue({
      workspace: HOST_WORKSPACE,
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

  it("names the shapes a regeneration cut loose from their nodes", async () => {
    // The merge released them in place and reported which ones, and the store
    // threw the report away — so a sticky note quietly stopped following its
    // subject, and whoever anchored it found out the next time they moved
    // that subject and nothing came with it.
    //
    // Driven the way it happens: an unsaved drawing anchored to a node, then
    // a regeneration that drops the node.
    const read = vi
      .spyOn(ProjectMapService, "readProjectMap")
      .mockResolvedValue({
        workspace: HOST_WORKSPACE,
        absolutePath: ABSOLUTE_PATH,
        raw: mapFile(),
      });
    const user = userEvent.setup();
    renderWithProviders(<MapRoute />);
    await screen.findByTestId("project-map-canvas");

    // Arrange: a shape anchored to a node, which makes the buffer dirty.
    act(() => {
      useProjectMapStore.getState().addShape({
        kind: "sticky",
        x: 10,
        y: 10,
        anchor: { layer: "code", node: "src/routes/home.tsx", dx: 0, dy: 0 },
      });
    });

    // Act: the agent regenerates without that node.
    read.mockResolvedValue({
      workspace: HOST_WORKSPACE,
      absolutePath: ABSOLUTE_PATH,
      raw: mapFile({ commit: "feed9999", nodes: [], edges: [] }),
    });
    await user.click(screen.getByTestId("project-map-refresh"));

    // Assert: said, and the id named — a bare count sends a reader hunting
    // through their own drawing.
    const notice = await screen.findByTestId("project-map-anchors-released");
    expect(notice).toHaveAttribute("data-count", "1");
    const [released] = useProjectMapStore.getState().releasedShapeIds;
    expect(notice).toHaveTextContent(released);
  });

  it("writes the arrangement back only when the user saves it", async () => {
    // Arrange
    vi.spyOn(ProjectMapService, "readProjectMap").mockResolvedValue({
      workspace: HOST_WORKSPACE,
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
    await user.click(
      screen.getByTestId("project-map-node-src/routes/home.tsx"),
    );
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

  it("names the file it tried to read when reading it fails", async () => {
    // Arrange: the read failed for a reason other than the file being absent.
    vi.spyOn(ProjectMapService, "readProjectMap").mockRejectedValue(
      new ProjectMapReadError(ABSOLUTE_PATH, new Error("is a directory")),
    );

    // Act
    renderWithProviders(<MapRoute />, { navigation: { currentPath: "/map" } });

    // Assert: the path comes from the failure, because a failed query has no
    // data to read it from.
    const notice = await screen.findByTestId("project-map-read-error");
    expect(notice).toHaveTextContent(ABSOLUTE_PATH);
  });

  it("leaves no empty gap when the path itself never resolved", async () => {
    // Arrange: a failure from before the path was known.
    vi.spyOn(ProjectMapService, "readProjectMap").mockRejectedValue(
      new Error("the agent server home is unreachable"),
    );

    // Act
    renderWithProviders(<MapRoute />, { navigation: { currentPath: "/map" } });

    // Assert: a sentence with a hole in it where a path should be is worse
    // than a sentence that does not promise one.
    const notice = await screen.findByTestId("project-map-read-error");
    expect(notice.textContent?.trim()).not.toMatch(/ {2}/);
    expect(notice.textContent?.trim()).not.toBe("");
  });

  it("tells the user a launch failed, not that a save failed", async () => {
    // Arrange
    vi.spyOn(ProjectMapService, "readProjectMap").mockResolvedValue({
      workspace: HOST_WORKSPACE,
      absolutePath: ABSOLUTE_PATH,
      raw: mapFile(),
    });
    launchConversation.mockRejectedValue(new Error("no runtime"));
    const user = userEvent.setup();
    renderWithProviders(<MapRoute />, { navigation: { currentPath: "/map" } });
    await screen.findByTestId("project-map-canvas");
    await openChat();
    await user.click(
      screen.getByTestId("project-map-node-src/stores/events.ts"),
    );

    // Act
    await user.click(screen.getByTestId("project-map-change"));

    // Assert: nothing was being written, so the save failure's sentence would
    // be a lie about what went wrong.
    await waitFor(() => {
      expect(displayErrorToast).toHaveBeenCalledWith(
        copy("PROJECT_MAP$LAUNCH_FAILED"),
      );
    });
    expect(displayErrorToast).not.toHaveBeenCalledWith(
      copy("PROJECT_MAP$SAVE_FAILED"),
    );
  });

  it("tells the agent the map's absolute path, not one relative to its own directory", async () => {
    // Arrange
    vi.spyOn(ProjectMapService, "readProjectMap").mockResolvedValue({
      workspace: HOST_WORKSPACE,
      absolutePath: ABSOLUTE_PATH,
      raw: mapFile(),
    });
    const user = userEvent.setup();
    renderWithProviders(<MapRoute />, { navigation: { currentPath: "/map" } });
    await screen.findByTestId("project-map-canvas");
    await openChat();

    // Act
    await user.click(
      screen.getByTestId("project-map-node-src/stores/events.ts"),
    );

    // Assert: the conversation this starts gets its own working directory
    // under the one the page read, so a relative path would point at no map.
    expect(screen.getByTestId("project-map-context-preview")).toHaveTextContent(
      ABSOLUTE_PATH,
    );
  });

  it("keeps the conversation it starts beside the canvas", async () => {
    // Arrange
    vi.spyOn(ProjectMapService, "readProjectMap").mockResolvedValue({
      workspace: HOST_WORKSPACE,
      absolutePath: ABSOLUTE_PATH,
      raw: mapFile(),
    });
    const navigate = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<MapRoute />, {
      navigation: { currentPath: "/map", conversationId: null, navigate },
    });
    await screen.findByTestId("project-map-canvas");
    await openChat();

    // Act
    await user.type(
      screen.getByTestId("project-map-composer"),
      "what is this?",
    );
    await user.click(screen.getByTestId("project-map-send"));

    // Assert: the conversation belongs to the pane now, and the user is still
    // looking at the map.
    await waitFor(() => {
      expect(screen.getByTestId("project-map-conversation")).toHaveAttribute(
        "data-conversation-id",
        "conversation-1",
      );
    });
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByTestId("project-map-canvas")).toBeInTheDocument();
    expect(screen.getByTestId("project-map-transcript")).toBeInTheDocument();
    // Opening it full screen is offered rather than forced.
    expect(
      screen.getByTestId("project-map-open-conversation"),
    ).toBeInTheDocument();
  });

  it("reports an unreachable sandbox instead of an empty map of somewhere else", async () => {
    // Arrange: the map is open on the backend's own workspace, and the
    // conversation the next send binds has lost its container.
    vi.spyOn(ProjectMapService, "readProjectMap").mockImplementation(
      async (target) => {
        if (target?.conversationId) {
          throw new ProjectMapRuntimeUnavailableError(target.conversationId);
        }
        return {
          workspace: HOST_WORKSPACE,
          absolutePath: ABSOLUTE_PATH,
          raw: mapFile(),
        };
      },
    );
    const user = userEvent.setup();
    renderWithProviders(<MapRoute />, {
      navigation: {
        currentPath: "/map",
        conversationId: null,
        navigate: vi.fn(),
      },
    });
    await screen.findByTestId("project-map-canvas");
    await openChat();

    // Act
    await user.type(screen.getByTestId("project-map-composer"), "what is it?");
    await user.click(screen.getByTestId("project-map-send"));

    // Assert: the page says the workspace cannot be reached. Drawing the
    // empty state instead would claim the repository has no map.
    const notice = await screen.findByTestId("project-map-runtime-unavailable");
    expect(notice).toHaveTextContent("conversation-1");
    expect(screen.queryByTestId("project-map-canvas")).toBeNull();
    expect(screen.queryByTestId("project-map-empty")).toBeNull();
  });

  it("turns a node the answer names into a control that selects it", async () => {
    // Arrange: a conversation bound to the pane.
    vi.spyOn(ProjectMapService, "readProjectMap").mockResolvedValue({
      workspace: HOST_WORKSPACE,
      absolutePath: ABSOLUTE_PATH,
      raw: mapFile(),
    });
    const user = userEvent.setup();
    renderWithProviders(<MapRoute />, {
      navigation: {
        currentPath: "/map",
        conversationId: null,
        navigate: vi.fn(),
      },
    });
    await screen.findByTestId("project-map-canvas");
    await openChat();
    await user.type(
      screen.getByTestId("project-map-composer"),
      "what is slow?",
    );
    await user.click(screen.getByTestId("project-map-send"));
    await screen.findByTestId("project-map-transcript");

    // Act: the agent answers, naming a node by its path.
    act(() => {
      useEventStore
        .getState()
        .addEvents([
          agentAnswer(
            "The slow part is src/stores/events.ts, which keeps every event.",
          ),
        ]);
    });

    // Assert: the mention is a control, and pressing it selects that node on
    // the canvas — which is what drives the next message's context block.
    const mention = await screen.findByTestId(
      "project-map-mention-src/stores/events.ts",
    );
    await user.click(mention);
    expect(screen.getByTestId("project-map-selection-chips")).toHaveTextContent(
      "events",
    );
    expect(screen.getByTestId("project-map-context-preview")).toHaveTextContent(
      'store "events" (src/stores/events.ts)',
    );
  });

  it("reads an ACP agent's answer, which ends in a finish action", async () => {
    // Arrange: a conversation bound to the pane. ACP profiles — Claude Code,
    // Codex — are how the map is most often driven, and they never emit an
    // assistant message event.
    vi.spyOn(ProjectMapService, "readProjectMap").mockResolvedValue({
      workspace: HOST_WORKSPACE,
      absolutePath: ABSOLUTE_PATH,
      raw: mapFile(),
    });
    const user = userEvent.setup();
    renderWithProviders(<MapRoute />, {
      navigation: {
        currentPath: "/map",
        conversationId: null,
        navigate: vi.fn(),
      },
    });
    await screen.findByTestId("project-map-canvas");
    await openChat();
    await user.type(
      screen.getByTestId("project-map-composer"),
      "who reads it?",
    );
    await user.click(screen.getByTestId("project-map-send"));
    await screen.findByTestId("project-map-transcript");

    // Act
    act(() => {
      useEventStore
        .getState()
        .addEvents([
          finishAction("src/routes/home.tsx reads it on every render."),
        ]);
    });

    // Assert
    expect(
      await screen.findByTestId("project-map-mention-src/routes/home.tsx"),
    ).toBeInTheDocument();
  });

  // Both agent families report a write differently and both drive this page,
  // so the refresh is proved against each.
  it.each([
    ["the OpenHands file editor", fileEdit],
    ["an ACP agent's edit tool call", acpFileEdit],
  ])(
    "picks up a map edit from %s without dropping unsaved moves",
    async (_label, edit) => {
      // Arrange: the page is open with an unsaved edit in hand.
      const read = vi
        .spyOn(ProjectMapService, "readProjectMap")
        .mockResolvedValue({
          workspace: HOST_WORKSPACE,
          absolutePath: ABSOLUTE_PATH,
          raw: mapFile(),
        });
      const user = userEvent.setup();
      renderWithProviders(<MapRoute />, {
        navigation: {
          currentPath: "/map",
          conversationId: null,
          navigate: vi.fn(),
        },
      });
      await screen.findByTestId("project-map-canvas");
      await user.click(
        screen.getByTestId("project-map-node-src/routes/home.tsx"),
      );
      await user.click(screen.getByTestId("project-map-toggle-hidden"));

      // The agent describes a node differently and adds one it found, leaving
      // the provenance fields alone — which is what an edit between
      // regenerations actually looks like on disk, and what the page would miss
      // if it recognised revisions by `commit` alone.
      read.mockResolvedValue({
        workspace: HOST_WORKSPACE,
        absolutePath: ABSOLUTE_PATH,
        raw: mapFile({
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
              summary: "Every event the agent emitted, deduped by id.",
              size: 300,
              x: 400,
              y: 0,
            },
            {
              id: "src/api/client.ts",
              kind: "service",
              label: "client",
              path: "src/api/client.ts",
              group: "web",
              summary: "Talks to the agent server.",
              size: 180,
              x: 800,
              y: 0,
            },
          ],
        }),
      });

      // Act: the write arrives as an observation on the pane's conversation. The
      // agent's path is longer than the page's, because its working directory is
      // a subdirectory of the one the page reads.
      act(() => {
        useEventStore
          .getState()
          .addEvents([
            edit(`/home/agent/workspace/project/sub/${PROJECT_MAP_FILE_PATH}`),
          ]);
      });

      // Assert: what the agent found landed, and the user's unsaved decision
      // survived it — `mergeProjectMap` gives facts to the analysis and the
      // arrangement to the person.
      await waitFor(() => {
        const open = useProjectMapStore.getState().document;
        expect(
          open?.nodes.find((node) => node.id === "src/api/client.ts"),
        ).toBeDefined();
      });
      const open = useProjectMapStore.getState().document;
      expect(
        open?.nodes.find((node) => node.id === "src/stores/events.ts")?.summary,
      ).toBe("Every event the agent emitted, deduped by id.");
      expect(
        open?.nodes.find((node) => node.id === "src/routes/home.tsx"),
      ).toMatchObject({ hidden: true, x: 0, y: 0 });
      expect(screen.getByTestId("project-map-unsaved")).toBeInTheDocument();
    },
  );

  /** A saved workspace on the backend's host, as the picker lists it. */
  const HAZARD = {
    id: "/home/agent/repos/hazard",
    name: "hazard",
    path: "/home/agent/repos/hazard",
  };

  /** The saved-workspaces list the picker draws from. */
  function saveWorkspaces(workspaces: (typeof HAZARD)[]) {
    vi.spyOn(WorkspacesService, "listWorkspaces").mockResolvedValue({
      workspaces,
      workspaceParents: [],
    });
  }

  /** Picks a saved workspace in the picker, the way a person would. */
  async function chooseRepository(
    user: ReturnType<typeof userEvent.setup>,
    name: string,
  ) {
    await user.click(await screen.findByTestId("workspace-dropdown"));
    const menu = await screen.findByTestId("workspace-dropdown-menu");
    await user.click(await within(menu).findByText(name));
  }

  it("reads the map from the repository the user chose, and remembers it", async () => {
    // Arrange: the backend's own directory has no map; the chosen folder has
    // one. Only a read aimed at that folder, on the host, finds it.
    saveWorkspaces([HAZARD]);
    const read = vi
      .spyOn(ProjectMapService, "readProjectMap")
      .mockImplementation(async (target) =>
        target?.workingDir
          ? {
              workspace: {
                conversationId: null,
                workingDir: target.workingDir,
              },
              absolutePath: `${target.workingDir}/${PROJECT_MAP_FILE_PATH}`,
              raw: mapFile(),
            }
          : emptyRead(target),
      );
    const user = userEvent.setup();
    renderWithProviders(<MapRoute />, { navigation: { currentPath: "/map" } });
    // The empty state leads with the question the page used to answer
    // silently.
    const empty = await screen.findByTestId("project-map-empty");
    expect(
      within(empty).getByTestId("project-map-workspace-picker"),
    ).toBeInTheDocument();

    // Act
    await chooseRepository(user, "hazard");

    // Assert: the drawing is that folder's, read from the host by its path,
    // and the page says so.
    await screen.findByTestId("project-map-canvas");
    expect(read).toHaveBeenLastCalledWith({
      conversationId: null,
      workingDir: HAZARD.path,
    });
    // The picker sits in the header, showing the choice, for switching.
    expect(screen.getByTestId("project-map-workspace-picker")).toHaveAttribute(
      "data-path",
      HAZARD.path,
    );
    // And the choice outlives this page: it is written through for the next
    // visit, under the backend it was made on.
    const persisted = JSON.parse(
      window.localStorage.getItem("project-map-workspace") ?? "{}",
    ).state.selectionByBackendId as Record<string, { path: string | null }>;
    expect(Object.values(persisted).map((entry) => entry.path)).toEqual([
      HAZARD.path,
    ]);
  });

  it("generates the chosen repository's map inside a sandbox mounted on it", async () => {
    // Arrange: a Docker backend, and a chosen folder with no map yet.
    clearCachedAgentServerInfo();
    server.use(
      http.get(`${localBackend.host}/server_info`, () =>
        HttpResponse.json({
          version: "1.57.0",
          uptime: 0,
          idle_time: 0,
          conversation_runtime: "docker",
        }),
      ),
    );
    saveWorkspaces([HAZARD]);
    vi.spyOn(ProjectMapService, "readProjectMap").mockImplementation(
      async (target) =>
        target?.workingDir
          ? {
              workspace: {
                conversationId: null,
                workingDir: target.workingDir,
              },
              absolutePath: `${target.workingDir}/${PROJECT_MAP_FILE_PATH}`,
              raw: null,
            }
          : emptyRead(target),
    );
    const user = userEvent.setup();
    renderWithProviders(<MapRoute />, { navigation: { currentPath: "/map" } });
    await screen.findByTestId("project-map-empty");
    await chooseRepository(user, "hazard");
    await waitFor(() =>
      expect(
        screen.getByTestId("project-map-workspace-picker"),
      ).toHaveAttribute("data-path", HAZARD.path),
    );
    // A chosen repository with no map is named, and the other maps are said
    // to be where they were — "No project map yet" after switching away from
    // a repository that had one read as that map being gone.
    expect(screen.getByTestId("project-map-empty")).toHaveTextContent(
      copy("PROJECT_MAP$EMPTY_TITLE_FOR").replace("{{repository}}", "hazard"),
    );
    expect(
      screen.getByTestId("project-map-empty-other-maps"),
    ).toBeInTheDocument();

    // Act
    await user.click(screen.getByTestId("project-map-generate"));

    // Assert: the conversation is attached to the folder — the runtime mounts
    // it as the sandbox's working directory — and told the repository-relative
    // name, because the host's absolute path names nothing in there.
    await waitFor(() => expect(launchConversation).toHaveBeenCalledTimes(1));
    const [, options] = launchConversation.mock.calls[0] as [
      unknown,
      { initialUserMsg?: string; workingDirOverride?: string },
    ];
    expect(options.workingDirOverride).toBe(HAZARD.path);
    expect(options.initialUserMsg).toContain(PROJECT_MAP_FILE_PATH);
    expect(options.initialUserMsg).not.toContain(HAZARD.path);
    // The page keeps watching the folder, with the conversation bound to it.
    await waitFor(() =>
      expect(
        screen.getByTestId("project-map-analysis-running"),
      ).toHaveTextContent("conversation-1"),
    );
    expect(screen.getByTestId("project-map-workspace-picker")).toHaveAttribute(
      "data-path",
      HAZARD.path,
    );
  });

  it("says which kind of backend cannot serve the map, for the harness too", async () => {
    // Arrange: the active backend only reaches the page through its provider.
    const read = vi.spyOn(ProjectMapService, "readProjectMap");
    setRegisteredBackends([cloudBackend]);
    setActiveSelection({ backendId: cloudBackend.id });

    // Act
    renderWithProviders(
      <ActiveBackendProvider>
        <MapRoute />
      </ActiveBackendProvider>,
      { navigation: { currentPath: "/map" } },
    );

    // Assert
    const notice = await screen.findByTestId("project-map-unsupported");
    expect(notice).toHaveAttribute("data-reason", "cloud-backend");
    expect(read).not.toHaveBeenCalled();
  });
});
