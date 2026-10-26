import { redirect } from "react-router";
import { readPinnedHomeRoute } from "#/hooks/use-pinned-home-route";

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
  return redirect(DEFAULT_HOME_ROUTE);
};

/** The front door when nothing is pinned. */
export const DEFAULT_HOME_ROUTE = "/map";

export { default } from "./home";
