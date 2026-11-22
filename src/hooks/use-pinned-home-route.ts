import { useLocalStorage } from "@uidotdev/usehooks";
import { useCallback, useMemo } from "react";
import {
  getActiveBackend,
  isNoBackend,
} from "#/api/backend-registry/active-store";
import { useActiveBackend } from "#/contexts/active-backend-context";
import {
  automationListPath,
  hasAutomationInterface,
} from "#/manifests/automation-interface";
import { getLockedCloudHost } from "#/api/agent-server-config";
import { PROJECT_MAP_ROUTE_PATH } from "#/types/project-map";

export const PINNED_HOME_ROUTE_KEY = "oh:pinned-home-route";

/** Sidebar Customize entry; also the pin target, so the two cannot drift. */
export const CUSTOMIZE_PATH = "/customize";
/** Where Home lives, and the front door for anyone who wants it back. */
export const CONVERSATIONS_PATH = "/conversations";

/**
 * The pin is stored per backend + org: it may reference a surface that only
 * exists on the backend that set it (e.g. /automations requires that
 * deployment's interface manifest) — a shared key would let one backend
 * redirect `/` on another.
 */
export function getPinnedHomeRouteKey(
  backendId: string,
  orgId: string | null,
): string {
  return `${PINNED_HOME_ROUTE_KEY}:${backendId}:${orgId ?? "-"}`;
}

/**
 * Whether `path` may serve as the home route right now. Shared by the
 * sidebar pin affordance and the `/` loader, so a stored pin that stops
 * resolving (backend switch, manifest absent) is ignored rather than an
 * error. `/` is never pinnable, which makes a redirect loop impossible.
 * Canvas Extensions pages can later add an `/extensions/…` branch here
 * without any storage or loader change.
 */
export function isPinnableRoute(path: string): boolean {
  if (path === CUSTOMIZE_PATH) return true;
  // Home itself. The map became the front door on the grounds that a pin
  // puts the conversation list back for anyone who wants it — which was not
  // true until this line: nothing could be pinned to Home, so the choice the
  // comment promised did not exist.
  if (path === CONVERSATIONS_PATH) return true;
  if (path === automationListPath()) return hasAutomationInterface();
  // The map reads a file from a local workspace, which a canvas locked to a
  // Cloud host never has — and `/` must not redirect to a page whose only
  // possible content is "unsupported here". Same guard the sidebar link uses.
  if (path === PROJECT_MAP_ROUTE_PATH) return getLockedCloudHost() === null;
  return false;
}

function sanitizePinnedRoute(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  return isPinnableRoute(value) ? value : null;
}

/**
 * Synchronous pin read for route loaders (no React context). Reads the key
 * `usePinnedHomeRoute` writes; `useLocalStorage` JSON-serializes values, so
 * parse defensively and treat anything unreadable as "no pin". An invalid
 * pin is ignored, not cleared — it may become valid again (e.g. the
 * automations interface returning after a backend switch back).
 */
export function readPinnedHomeRoute(): string | null {
  const active = getActiveBackend();
  if (isNoBackend(active.backend)) return null;

  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(
      getPinnedHomeRouteKey(active.backend.id, active.orgId),
    );
  } catch {
    return null;
  }
  if (raw === null) return null;

  try {
    return sanitizePinnedRoute(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Pin state for the home route: `/` redirects to the pinned sidebar page. */
export function usePinnedHomeRoute() {
  const active = useActiveBackend();
  const [rawPinnedRoute, setRawPinnedRoute] = useLocalStorage<string | null>(
    getPinnedHomeRouteKey(active.backend.id, active.orgId),
    null,
  );

  const pinnedRoute = useMemo(
    () => sanitizePinnedRoute(rawPinnedRoute),
    [rawPinnedRoute],
  );

  const isPinnedRoute = useCallback(
    (path: string) => pinnedRoute === path,
    [pinnedRoute],
  );

  const togglePinnedRoute = useCallback(
    (path: string) => {
      if (pinnedRoute === path) {
        setRawPinnedRoute(null);
        return;
      }
      if (!isPinnableRoute(path)) return;
      setRawPinnedRoute(path);
    },
    [pinnedRoute, setRawPinnedRoute],
  );

  return {
    pinnedRoute,
    isPinnedRoute,
    togglePinnedRoute,
  };
}
