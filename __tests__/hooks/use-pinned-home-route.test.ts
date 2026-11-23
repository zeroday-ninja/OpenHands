import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONVERSATIONS_PATH,
  PINNED_HOME_ROUTE_KEY,
  getPinnedHomeRouteKey,
  isPinnableRoute,
} from "#/hooks/use-pinned-home-route";
import { getLockedCloudHost } from "#/api/agent-server-config";
import { PROJECT_MAP_ROUTE_PATH } from "#/types/project-map";
import { WORKBENCH_ROUTE_PATH } from "#/types/workbench";

// Whether this canvas is locked to a Cloud host is decided by another module,
// from a value the host page injects. Driving that value here would mean
// copying its window key into the test; what this file is about is what the
// pin does with the answer.
vi.mock("#/api/agent-server-config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#/api/agent-server-config")>()),
  getLockedCloudHost: vi.fn(() => null),
}));

describe("getPinnedHomeRouteKey", () => {
  it("scopes the storage key by backend and org", () => {
    expect(getPinnedHomeRouteKey("backend-a", "org-1")).toBe(
      `${PINNED_HOME_ROUTE_KEY}:backend-a:org-1`,
    );
    expect(getPinnedHomeRouteKey("backend-a", null)).toBe(
      `${PINNED_HOME_ROUTE_KEY}:backend-a:-`,
    );
    expect(getPinnedHomeRouteKey("backend-a", "org-1")).not.toBe(
      getPinnedHomeRouteKey("backend-b", "org-1"),
    );
  });
});

describe("isPinnableRoute", () => {
  afterEach(() => {
    vi.mocked(getLockedCloudHost).mockReturnValue(null);
  });

  it("lets the conversation list be home, which is how you get it back", () => {
    // The map became the front door on the grounds that a pin puts the
    // conversation list back for anyone who wants it. Nothing could be
    // pinned to Home until now, so that choice did not exist.
    expect(isPinnableRoute(CONVERSATIONS_PATH)).toBe(true);

    // Still true on a canvas locked to Cloud, where the map is not.
    vi.mocked(getLockedCloudHost).mockReturnValue("https://app.all-hands.dev");
    expect(isPinnableRoute(CONVERSATIONS_PATH)).toBe(true);
  });

  it.each([PROJECT_MAP_ROUTE_PATH, WORKBENCH_ROUTE_PATH])(
    "allows %s as home only when the canvas can access local workspaces",
    (path) => {
      expect(isPinnableRoute(path)).toBe(true);

      vi.mocked(getLockedCloudHost).mockReturnValue(
        "https://app.all-hands.dev",
      );

      expect(isPinnableRoute(path)).toBe(false);
    },
  );
});
