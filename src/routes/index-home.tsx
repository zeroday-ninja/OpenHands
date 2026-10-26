import { redirect } from "react-router";
import { readPinnedHomeRoute } from "#/hooks/use-pinned-home-route";
import { getActiveBackend } from "#/api/backend-registry/active-store";
import { getLockedCloudHost } from "#/api/agent-server-config";
import { projectMapUnsupportedReasonFor } from "#/api/project-map-service/project-map-service.api";

/**
 * Where `/` goes.
 *
 * A home pin for the active backend + org wins: `readPinnedHomeRoute` only
 * returns routes that currently resolve (never `/` itself), so a stale pin
 * falls through with no error and no redirect loop.
 *
 * With no pin, the map. The plan's centre of gravity is the canvas — "the
 * visual canvas is where you work, with chat secondary" — and a product
 * whose front door was still the conversation list said the opposite every
 * time it opened. The conversation list stays reachable unmodified at
 * /conversations, and a pin to it puts it back as the front door for anyone
 * who wants that.
 */
export const clientLoader = () => {
  const pinnedRoute = readPinnedHomeRoute();
  if (pinnedRoute) return redirect(pinnedRoute);
  return redirect(defaultHomeRoute());
};

/** The front door when nothing is pinned. */
export const DEFAULT_HOME_ROUTE = "/map";

/** Where Home lives when the map cannot be the front door. */
export const HOME_ROUTE = "/conversations";

/**
 * The front door for the backend in front of the user.
 *
 * The map reads a file from a local workspace, so a cloud backend — and a
 * canvas locked to a cloud host, where the sidebar hides the map entirely —
 * can only show "unsupported here". `isPinnableRoute` already refuses to
 * pin the map for that reason, in those words; the default was not held to
 * the same rule, so `/` opened on a page that says it cannot work. The
 * conversation list is the front door there.
 */
export function defaultHomeRoute(): string {
  if (getLockedCloudHost() !== null) return HOME_ROUTE;
  const { backend } = getActiveBackend();
  return projectMapUnsupportedReasonFor(backend) === "cloud-backend"
    ? HOME_ROUTE
    : DEFAULT_HOME_ROUTE;
}

export { default } from "./home";
