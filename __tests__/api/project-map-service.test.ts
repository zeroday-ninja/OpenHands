import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  setActiveSelection,
  setRegisteredBackends,
} from "#/api/backend-registry/active-store";
import type { Backend } from "#/api/backend-registry/types";
import AgentServerConversationService from "#/api/conversation-service/agent-server-conversation-service.api";
import type { AppConversation } from "#/api/conversation-service/agent-server-conversation-service.types";
import ProjectMapService, {
  isProjectMapUnsupportedError,
  projectMapReadErrorPath,
  projectMapUnavailableRuntimeConversation,
  projectMapUnsupportedReasonFor,
  ProjectMapUnsupportedError,
} from "#/api/project-map-service/project-map-service.api";
import { PROJECT_MAP_FILE_PATH } from "#/types/project-map";

/**
 * A Docker-sandbox conversation as the agent server describes it: its
 * workspace is an absolute path inside its own container, not a directory
 * under the agent server's home.
 */
function sandboxConversation(id: string): AppConversation {
  return {
    id,
    workspace: { working_dir: "/workspace" },
  } as AppConversation;
}

const downloadTextFile = vi.hoisted(() => vi.fn());
const uploadTextFile = vi.hoisted(() => vi.fn());
const close = vi.hoisted(() => vi.fn());

vi.mock("@openhands/typescript-client/clients", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  FileClient: vi.fn(function FileClientMock() {
    return { downloadTextFile, uploadTextFile, close };
  }),
}));

// The absolute-path leg is its own tested concern (spec WUP-001); here it only
// has to be the *same* resolution for reads and writes.
vi.mock("#/api/workspace-upload-path", () => ({
  resolveAbsoluteWorkspacePath: vi.fn(async (workingDir: string) =>
    workingDir.startsWith("/") ? workingDir : `/home/agent/${workingDir}`,
  ),
}));

const localBackend: Backend = {
  id: "local-test",
  name: "Local test backend",
  host: "http://localhost:3000",
  apiKey: "test-session-key",
  kind: "local",
};

const cloudBackend: Backend = {
  ...localBackend,
  id: "cloud-test",
  kind: "cloud",
};

function httpError(status: number) {
  return Object.assign(new Error(`HTTP ${status}`), {
    name: "HttpError",
    status,
  });
}

describe("ProjectMapService", () => {
  beforeEach(() => {
    downloadTextFile.mockReset();
    uploadTextFile.mockReset();
    close.mockReset();
    setRegisteredBackends([localBackend]);
    setActiveSelection({ backendId: localBackend.id });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setActiveSelection(null);
    setRegisteredBackends([]);
  });

  it("reads the map from the conversation's own workspace", async () => {
    // Arrange: the conversation runs in its own sandbox, where the repository
    // and its map are, and the agent server's home directory is not.
    vi.spyOn(
      AgentServerConversationService,
      "batchGetAppConversations",
    ).mockResolvedValue([sandboxConversation("conversation-1")]);
    downloadTextFile.mockResolvedValue('{"version":1}');

    // Act
    const file = await ProjectMapService.readProjectMap({
      conversationId: "conversation-1",
    });

    // Assert
    expect(file.absolutePath).toBe(`/workspace/${PROJECT_MAP_FILE_PATH}`);
    expect(file.workspace).toEqual({
      conversationId: "conversation-1",
      workingDir: "/workspace",
    });
    expect(file.raw).toBe('{"version":1}');
    expect(close).toHaveBeenCalled();
  });

  it("reads the backend's own workspace when there is no conversation", async () => {
    // Arrange
    const batch = vi.spyOn(
      AgentServerConversationService,
      "batchGetAppConversations",
    );
    downloadTextFile.mockResolvedValue("{}");

    // Act
    const file = await ProjectMapService.readProjectMap();

    // Assert: the page says which workspace it read, and no conversation was
    // consulted to find it.
    expect(file.workspace).toEqual({
      conversationId: null,
      workingDir: "/home/agent/workspace/project",
    });
    expect(batch).not.toHaveBeenCalled();
  });

  it("refuses to answer for a conversation the server cannot describe", async () => {
    // Arrange: a conversation that is gone, which is what a deleted or
    // recycled sandbox looks like from here.
    vi.spyOn(
      AgentServerConversationService,
      "batchGetAppConversations",
    ).mockResolvedValue([null]);

    // Act
    const error = await ProjectMapService.readProjectMap({
      conversationId: "conversation-9",
    }).catch((caught: unknown) => caught);

    // Assert: falling back to the backend's directory would answer a question
    // about one workspace with a file from another.
    expect(projectMapUnavailableRuntimeConversation(error)).toBe(
      "conversation-9",
    );
    expect(downloadTextFile).not.toHaveBeenCalled();
  });

  it("reports an archived sandbox as unreachable, not as a repository without a map", async () => {
    // Arrange: the agent server answers 410 for a runtime it has archived.
    vi.spyOn(
      AgentServerConversationService,
      "batchGetAppConversations",
    ).mockResolvedValue([sandboxConversation("conversation-1")]);
    downloadTextFile.mockRejectedValue(httpError(410));

    // Act
    const error = await ProjectMapService.readProjectMap({
      conversationId: "conversation-1",
    }).catch((caught: unknown) => caught);

    // Assert
    expect(projectMapUnavailableRuntimeConversation(error)).toBe(
      "conversation-1",
    );
    expect(close).toHaveBeenCalled();
  });

  it("recognizes an unreachable runtime after a cache round trip loses the prototype", () => {
    // Arrange: React Query hands back a plain object, not the class instance.
    const revived = {
      name: "ProjectMapRuntimeUnavailableError",
      conversationId: "conversation-1",
    };

    // Act / Assert
    expect(projectMapUnavailableRuntimeConversation(revived)).toBe(
      "conversation-1",
    );
    expect(
      projectMapUnavailableRuntimeConversation(new Error("nope")),
    ).toBeNull();
  });

  it("reports an absent file as an empty map rather than an error", async () => {
    // Arrange
    downloadTextFile.mockRejectedValue(httpError(404));

    // Act
    const file = await ProjectMapService.readProjectMap();

    // Assert
    expect(file.raw).toBeNull();
    expect(close).toHaveBeenCalled();
  });

  it("reports a real read failure with the path it tried, so the page can name it", async () => {
    // Arrange
    const cause = httpError(500);
    downloadTextFile.mockRejectedValue(cause);

    // Act
    const error = await ProjectMapService.readProjectMap().catch(
      (caught: unknown) => caught,
    );

    // Assert: the page has no other way to learn the path — a failed query
    // carries no data, and resolving it again is an async call.
    expect(projectMapReadErrorPath(error)).toBe(
      `/home/agent/workspace/project/${PROJECT_MAP_FILE_PATH}`,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).cause).toBe(cause);
    expect(close).toHaveBeenCalled();
  });

  it("writes to the exact path it reads from, so a save lands where the map came from", async () => {
    // Arrange
    vi.spyOn(
      AgentServerConversationService,
      "batchGetAppConversations",
    ).mockResolvedValue([sandboxConversation("conversation-1")]);
    uploadTextFile.mockResolvedValue({ success: true });
    downloadTextFile.mockResolvedValue("{}");
    const read = await ProjectMapService.readProjectMap({
      conversationId: "conversation-1",
    });

    // Act
    const written = await ProjectMapService.writeProjectMap("{}\n", {
      conversationId: "conversation-1",
    });

    // Assert
    expect(written).toBe(read.absolutePath);
    expect(uploadTextFile).toHaveBeenCalledWith("{}\n", read.absolutePath);
  });

  it("declares Cloud unsupported without making a request", () => {
    // Act
    const reason = projectMapUnsupportedReasonFor(cloudBackend);

    // Assert
    expect(reason).toBe("cloud-backend");
    expect(downloadTextFile).not.toHaveBeenCalled();
  });

  it("recognizes its own unsupported error after a cache round trip loses the prototype", () => {
    // Arrange: React Query hands back a plain object, not the class instance.
    const original = new ProjectMapUnsupportedError("cloud-backend");
    const revived = { name: original.name, message: original.message };

    // Act / Assert
    expect(isProjectMapUnsupportedError(revived)).toBe(true);
    expect(isProjectMapUnsupportedError(new Error("nope"))).toBe(false);
  });
});
