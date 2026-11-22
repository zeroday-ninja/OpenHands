import { redirect } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetActiveStoreForTests,
  setActiveSelection,
  setRegisteredBackends,
} from "#/api/backend-registry/active-store";
import type { Backend } from "#/api/backend-registry/types";
import { getPinnedHomeRouteKey } from "#/hooks/use-pinned-home-route";
import { clientLoader } from "#/routes/index-home";

/**
 * The automation interface manifest is withheld so the "pinned page's
 * feature is no longer available" case is exercisable; /customize has no
 * such gate and stays pinnable.
 */
vi.mock("#/manifests/manifest-sources", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("#/manifests/manifest-sources")>();
  return { ...actual, AUTOMATION_INTERFACE_CANDIDATE: undefined };
});

// Only the loader is under test; keep the home screen's tree out of it.
vi.mock("#/routes/home", () => ({ default: () => null }));

const BACKEND: Backend = {
  id: "backend-a",
  name: "Backend A",
  host: "http://localhost:3000",
  apiKey: "",
  kind: "local",
};

const PIN_KEY = getPinnedHomeRouteKey(BACKEND.id, null);

/** What the router hands a loader: the request for the address asked for. */
function at(path: string) {
  return { request: new Request(`http://localhost${path}`) };
}

describe("the index route with a pinned home page", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setRegisteredBackends([BACKEND]);
    setActiveSelection({ backendId: BACKEND.id });
  });

  afterEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    __resetActiveStoreForTests();
  });

  it("redirects / to the pinned page of the active backend", () => {
    // Arrange
    window.localStorage.setItem(PIN_KEY, JSON.stringify("/customize"));

    // Act
    const result = clientLoader(at("/"));

    // Assert
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).headers.get("Location")).toBe("/customize");
  });

  // With no pin, the map: the canvas is where the work is, and a front door
  // that opened on the conversation list said the opposite every time.
  it("carries the query through to wherever / goes", () => {
    // `/?previewOnboardingStep=2` is a documented way in. Dropping the
    // search string made it a plain redirect with no preview and no error.
    expect(clientLoader(at("/?previewOnboardingStep=2"))).toEqual(
      redirect("/map?previewOnboardingStep=2"),
    );
  });

  it("sends / to the conversations list with nothing registered", () => {
    // The map's only content there is "no backend" — the same dead end as
    // a cloud backend, by another name.
    setRegisteredBackends([]);
    setActiveSelection(null);

    expect(clientLoader(at("/"))).toEqual(redirect("/conversations"));
  });

  it("sends / to the conversations list on a backend the map cannot serve", () => {
    // Arrange: a cloud backend. The map reads a file from a local workspace,
    // so it can only say "unsupported here" — which is what the front door
    // opened on. `isPinnableRoute` already refuses to pin the map for a
    // cloud canvas, in those words; the default was not held to that rule.
    const cloud: Backend = {
      id: "backend-cloud",
      name: "Cloud",
      host: "https://app.all-hands.dev",
      apiKey: "",
      kind: "cloud",
    };
    setRegisteredBackends([cloud]);
    setActiveSelection({ backendId: cloud.id });

    // Act and assert
    expect(clientLoader(at("/"))).toEqual(redirect("/conversations"));
  });

  it("sends / to the map when no pin is set", () => {
    expect(clientLoader(at("/"))).toEqual(redirect("/map"));
  });

  it("falls back to the map when the stored pin does not resolve, leaving the value intact", () => {
    for (const rawValue of ['"/"', '"/nonexistent"', "not-json"]) {
      // Arrange
      window.localStorage.setItem(PIN_KEY, rawValue);

      // Act & Assert
      expect(clientLoader(at("/"))).toEqual(redirect("/map"));
      expect(window.localStorage.getItem(PIN_KEY)).toBe(rawValue);
    }
  });

  it("falls back to the map when the pinned page's interface is absent", () => {
    // Arrange: /automations was pinnable when set, but this deployment has
    // no admitted automation interface manifest.
    window.localStorage.setItem(PIN_KEY, JSON.stringify("/automations"));

    // Act & Assert
    expect(clientLoader(at("/"))).toEqual(redirect("/map"));
  });

  it("ignores a pin stored for a different backend", () => {
    // Arrange
    window.localStorage.setItem(
      getPinnedHomeRouteKey("backend-b", null),
      JSON.stringify("/customize"),
    );

    // Act & Assert
    expect(clientLoader(at("/"))).toEqual(redirect("/map"));
  });
});
