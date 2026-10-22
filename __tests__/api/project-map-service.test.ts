import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  setActiveSelection,
  setRegisteredBackends,
} from "#/api/backend-registry/active-store";
import type { Backend } from "#/api/backend-registry/types";
import ProjectMapService, {
  isProjectMapUnsupportedError,
  projectMapUnsupportedReasonFor,
  ProjectMapUnsupportedError,
} from "#/api/project-map-service/project-map-service.api";
import { PROJECT_MAP_FILE_PATH } from "#/types/project-map";

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
  resolveAbsoluteWorkspacePath: vi.fn(
    async (workingDir: string) => `/home/agent/${workingDir}`,
  ),
  resolveConversationUploadWorkingDir: vi.fn(
    async () => "workspace/project/the-repo",
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
    setActiveSelection(null);
    setRegisteredBackends([]);
  });

  it("reads the map from the conversation's own workspace", async () => {
    // Arrange
    downloadTextFile.mockResolvedValue('{"version":1}');

    // Act
    const file = await ProjectMapService.readProjectMap({
      conversationId: "conversation-1",
    });

    // Assert
    expect(file.absolutePath).toBe(
      `/home/agent/workspace/project/the-repo/${PROJECT_MAP_FILE_PATH}`,
    );
    expect(file.raw).toBe('{"version":1}');
    expect(close).toHaveBeenCalled();
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

  it("leaves a real read failure alone so the page can offer a retry", async () => {
    // Arrange
    downloadTextFile.mockRejectedValue(httpError(500));

    // Act
    const error = await ProjectMapService.readProjectMap().catch(
      (caught: unknown) => caught,
    );

    // Assert
    expect(error).toBeInstanceOf(Error);
    expect(close).toHaveBeenCalled();
  });

  it("writes to the exact path it reads from, so a save lands where the map came from", async () => {
    // Arrange
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
