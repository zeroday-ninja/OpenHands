import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentServerClient } from "@openhands/typescript-client/clients";
import {
  setActiveSelection,
  setRegisteredBackends,
} from "#/api/backend-registry/active-store";
import type { Backend } from "#/api/backend-registry/types";
import SoulService, {
  SoulUnsupportedError,
  isSoulUnsupportedError,
} from "./soul-service.api";
import type { SoulResponse } from "./soul.types";

const getMock = vi.hoisted(() => vi.fn());
const putMock = vi.hoisted(() => vi.fn());
const closeMock = vi.hoisted(() => vi.fn());

vi.mock("@openhands/typescript-client/clients", () => ({
  AgentServerClient: vi.fn(function AgentServerClientMock() {
    return { get: getMock, put: putMock, close: closeMock };
  }),
  // Imported by `agent-server-compatibility`, which the service reads its
  // HTTP-status helper from; never called on these paths.
  ServerClient: vi.fn(),
  SettingsClient: vi.fn(),
}));

const localBackend: Backend = {
  id: "local-test",
  name: "Local test backend",
  host: "http://localhost:3000",
  apiKey: "test-session-key",
  kind: "local",
};

const cloudBackend: Backend = {
  id: "cloud-test",
  name: "Cloud test backend",
  host: "https://app.all-hands.dev",
  apiKey: "cloud-key",
  kind: "cloud",
};

const soul: SoulResponse = {
  content: "# Soul\n\nReview before you write.\n",
  exists: true,
  path: "/home/user/.openhands/SOUL.md",
  size_bytes: 36,
};

/** What the SDK client throws for a non-2xx response. */
function httpError(status: number) {
  return Object.assign(new Error(`HTTP ${status}`), {
    name: "HttpError",
    status,
  });
}

describe("SoulService", () => {
  beforeEach(() => {
    getMock.mockReset();
    putMock.mockReset();
    closeMock.mockReset();
    vi.mocked(AgentServerClient).mockClear();
    setRegisteredBackends([localBackend]);
    setActiveSelection({ backendId: localBackend.id });
  });

  afterEach(() => {
    setActiveSelection(null);
    setRegisteredBackends([]);
  });

  it("reads SOUL.md through the typed client and closes it", async () => {
    getMock.mockResolvedValue(soul);

    const result = await SoulService.getSoul();

    expect(result).toEqual(soul);
    expect(vi.mocked(AgentServerClient)).toHaveBeenCalledWith({
      host: "http://localhost:3000",
      apiKey: "test-session-key",
    });
    expect(getMock).toHaveBeenCalledWith("/api/soul");
    expect(closeMock).toHaveBeenCalled();
  });

  it("writes the content the editor sends", async () => {
    putMock.mockResolvedValue(soul);

    await SoulService.saveSoul("new text");

    expect(putMock).toHaveBeenCalledWith("/api/soul", { content: "new text" });
    expect(closeMock).toHaveBeenCalled();
  });

  it("turns a 404 into an unsupported-API result, not an error", async () => {
    getMock.mockRejectedValue(httpError(404));

    const error = await SoulService.getSoul().catch(
      (caught: unknown) => caught,
    );

    expect(isSoulUnsupportedError(error)).toBe(true);
    expect((error as SoulUnsupportedError).reason).toBe("missing-api");
    expect(closeMock).toHaveBeenCalled();
  });

  it("leaves a real failure alone so the page can offer a retry", async () => {
    getMock.mockRejectedValue(httpError(500));

    const error = await SoulService.getSoul().catch(
      (caught: unknown) => caught,
    );

    expect(isSoulUnsupportedError(error)).toBe(false);
  });

  it("never calls a cloud backend, which has no such route", async () => {
    setRegisteredBackends([cloudBackend]);
    setActiveSelection({ backendId: cloudBackend.id });

    const error = await SoulService.getSoul().catch(
      (caught: unknown) => caught,
    );

    expect((error as SoulUnsupportedError).reason).toBe("cloud-backend");
    expect(vi.mocked(AgentServerClient)).not.toHaveBeenCalled();
    expect(getMock).not.toHaveBeenCalled();
  });
});
