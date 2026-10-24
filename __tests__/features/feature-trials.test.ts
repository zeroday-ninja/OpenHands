import { describe, expect, it } from "vitest";
import translations from "../../src/i18n/translation.json";
import {
  FEATURE_TRIALS,
  featureTrialsOn,
  findFeatureTrial,
} from "#/features/feature-trials";
import routes from "#/routes";

const LOCALES = Object.keys(
  (translations as Record<string, Record<string, string>>)[
    "FEATURE$ANNOUNCE$HEADING"
  ],
);

function keyExistsEverywhere(key: string): boolean {
  const entry = (translations as Record<string, Record<string, string>>)[key];
  if (!entry) return false;
  return LOCALES.every((locale) => Boolean(entry[locale]?.trim()));
}

describe("the register of features this app shipped itself", () => {
  it("is what holds every feature to an announcement and a rating", () => {
    // The gate: one entry generates the announcement, the walkthrough and the
    // rating, so a feature cannot ship with one and not the others. This test
    // is what stops an entry from being added with pieces missing.
    expect(FEATURE_TRIALS.length).toBeGreaterThan(0);
    FEATURE_TRIALS.forEach((trial) => {
      expect(trial.id, "every trial needs a stable id").toBeTruthy();
      expect(trial.route.startsWith("/"), `${trial.id} route`).toBe(true);
      expect(
        trial.steps.length,
        `${trial.id} needs at least one walkthrough step`,
      ).toBeGreaterThan(0);
      expect(trial.shippedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  it("names only ids that are unique", () => {
    // The ledger is keyed by id, so a duplicate would merge two features'
    // usage into one record and make both look more used than they are.
    const ids = FEATURE_TRIALS.map((trial) => trial.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("names only text that every locale has", () => {
    // An announcement is the one thing a user reads before touching a
    // feature, so a missing translation is the first impression.
    FEATURE_TRIALS.forEach((trial) => {
      const keys = [
        trial.titleKey,
        trial.summaryKey,
        ...trial.steps.flatMap((step) => [step.titleKey, step.bodyKey]),
      ];
      keys.forEach((key) => {
        expect(keyExistsEverywhere(key), `${trial.id}: ${key}`).toBe(true);
      });
    });
  });

  it("points at routes this app actually serves", () => {
    // A walkthrough can only point at an element where that element renders,
    // so a trial on a route nothing serves is a walkthrough nobody sees.
    const served = new Set(
      routes.flatMap((route) => collectPaths(route as RouteLike, "")),
    );

    FEATURE_TRIALS.forEach((trial) => {
      expect(served.has(trial.route), `${trial.id} -> ${trial.route}`).toBe(
        true,
      );
    });
  });

  it("finds a trial by id and by the route it lives on", () => {
    const [first] = FEATURE_TRIALS;

    expect(findFeatureTrial(first.id)).toBe(first);
    expect(findFeatureTrial("nothing-like-this")).toBeNull();
    expect(featureTrialsOn(first.route)).toContain(first);
    expect(featureTrialsOn("/nowhere")).toEqual([]);
  });
});

interface RouteLike {
  path?: string;
  index?: boolean;
  children?: RouteLike[];
}

function collectPaths(route: RouteLike, prefix: string): string[] {
  const own =
    route.path === undefined
      ? prefix
      : `${prefix.replace(/\/$/, "")}/${route.path}`.replace(/\/\//g, "/");
  const here = route.path === undefined ? [] : [own];
  const below = (route.children ?? []).flatMap((child) =>
    collectPaths(child, own),
  );
  return [...here, ...below];
}
