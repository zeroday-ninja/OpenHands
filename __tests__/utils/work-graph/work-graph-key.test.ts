import { describe, expect, it } from "vitest";
import type { Backend } from "#/api/backend-registry/types";
import {
  globalizeWorkGraphKey,
  parseWorkGraphKey,
  workGraphBackendKey,
} from "#/utils/work-graph/work-graph-key";

function backend(overrides: Partial<Backend> = {}): Backend {
  return {
    id: "3f1a9c14-2b7e-4d55-9a0f-6c8e51d2b7aa",
    name: "Workstation",
    host: "http://localhost:8000",
    apiKey: "session-key",
    kind: "local",
    ...overrides,
  };
}

describe("work graph keys", () => {
  it("round-trips a deployment-relative node key through the global grammar", () => {
    // Arrange
    const backendKey = workGraphBackendKey(
      backend({ host: "http://LocalHost:8000/" }),
      null,
    );

    // Act
    const key = globalizeWorkGraphKey(backendKey, "cycle:5f1c9a");

    // Assert
    expect(key).toBe("oh:1/local:localhost:8000/cycle:5f1c9a");
    expect(parseWorkGraphKey(key as string)).toEqual({
      status: "resolved",
      key,
      version: 1,
      backendKey: "local:localhost:8000",
      kindToken: "cycle",
      id: "5f1c9a",
      isContentAddressed: false,
    });
  });

  it("builds one content-addressed key for a repository whichever deployment reports it", () => {
    // Arrange: two unrelated deployments reporting the same repository.
    const one = workGraphBackendKey(
      backend({ host: "http://localhost:8000" }),
      null,
    );
    const two = workGraphBackendKey(
      backend({
        id: "other",
        host: "https://agents.example.com",
        kind: "cloud",
      }),
      "org-7",
    );

    // Act
    const fromOne = globalizeWorkGraphKey(
      one,
      "repo:https://github.com/acme/app@main",
    );
    const fromTwo = globalizeWorkGraphKey(
      two,
      "repo:https://github.com/acme/app@main",
    );

    // Assert: no backend part at all, so the two collapse on sight, and the
    // slashes of the repository URL survive the trip.
    expect(fromOne).toBe("oh:1//repo:https://github.com/acme/app@main");
    expect(fromTwo).toBe(fromOne);
    expect(parseWorkGraphKey(fromOne as string)).toMatchObject({
      status: "resolved",
      backendKey: null,
      kindToken: "repo",
      id: "https://github.com/acme/app@main",
      isContentAddressed: true,
    });
  });

  it("builds one key for a pull request, in both the spellings a service uses", () => {
    // Milestone 3 names these: "repositories, sources and PRs
    // content-addressed so they carry no backend prefix and become the join
    // between backends". Only the repository had a case, and PRs are the one
    // a reader is most likely to see twice — two deployments working the same
    // repository both report the pull request they opened against it.
    const one = workGraphBackendKey(
      backend({ host: "http://localhost:8000" }),
      null,
    );
    const two = workGraphBackendKey(
      backend({
        id: "other",
        host: "https://agents.example.com",
        kind: "cloud",
      }),
      "org-7",
    );
    const pr = "pr:https://github.com/acme/app/pull/12";

    // Act: the bare spelling and the artifact-prefixed one the service also
    // emits, from two unrelated deployments.
    const bare = [one, two].map((key) => globalizeWorkGraphKey(key, pr));
    const prefixed = [one, two].map((key) =>
      globalizeWorkGraphKey(key, `artifact:${pr}`),
    );

    // Assert: each spelling collapses to one key across deployments, and
    // neither carries a backend part — a backend-scoped pull request would be
    // drawn once per deployment that mentioned it.
    expect(bare[0]).toBe(bare[1]);
    expect(prefixed[0]).toBe(prefixed[1]);
    expect(parseWorkGraphKey(bare[0] as string)).toMatchObject({
      status: "resolved",
      backendKey: null,
      isContentAddressed: true,
    });
    expect(parseWorkGraphKey(prefixed[0] as string)).toMatchObject({
      status: "resolved",
      backendKey: null,
      isContentAddressed: true,
    });
  });

  it("reports a key from an older grammar version as unresolved rather than re-matching it", () => {
    // Act
    const parsed = parseWorkGraphKey("oh:0/local:localhost:8000/cycle:5f1c9a");

    // Assert: no parts, because the segments may mean something else in that
    // grammar and a committed annotation must not be re-pointed by a guess.
    expect(parsed).toEqual({
      status: "unresolved",
      key: "oh:0/local:localhost:8000/cycle:5f1c9a",
      reason: "unsupported-version",
      version: 0,
    });
  });

  it("derives a backend key from the deployment, not from the registry id", () => {
    // Arrange: one deployment, registered twice — the ids are generated per
    // browser, so a key built from one would mean nothing on another machine.
    const here = backend({
      id: "id-from-this-browser",
      host: "http://Example.com:80/",
    });
    const there = backend({
      id: "id-from-another-browser",
      host: "https://example.com:443",
    });

    // Act
    const keyHere = workGraphBackendKey(here, null);
    const keyThere = workGraphBackendKey(there, null);

    // Assert
    expect(keyHere).toBe("local:example.com");
    expect(keyThere).toBe(keyHere);
    expect(keyHere).not.toContain(here.id);
    expect(keyHere).not.toContain(there.id);
  });

  it("keeps a cloud deployment's organization inside the backend part", () => {
    // Arrange
    const cloud = backend({ host: "https://app.all-hands.dev", kind: "cloud" });

    // Act
    const withOrg = globalizeWorkGraphKey(
      workGraphBackendKey(cloud, "org-7"),
      "run:a1",
    );
    const withoutOrg = globalizeWorkGraphKey(
      workGraphBackendKey(cloud, null),
      "run:a1",
    );

    // Assert: the organization segment is always present, empty when there is
    // none, so one deployment's two organizations never share a node key.
    expect(withOrg).toBe("oh:1/cloud:app.all-hands.dev/org-7/run:a1");
    expect(parseWorkGraphKey(withOrg as string)).toMatchObject({
      backendKey: "cloud:app.all-hands.dev/org-7",
      kindToken: "run",
      id: "a1",
    });
    expect(parseWorkGraphKey(withoutOrg as string)).toMatchObject({
      backendKey: "cloud:app.all-hands.dev/",
      id: "a1",
    });
  });

  it("keeps a key parseable when the deployment is hosted under a path prefix", () => {
    // Arrange: the path's separator would otherwise be read as the end of the
    // backend part, and the node key would be lost.
    const hosted = backend({ host: "https://example.com/canvas/" });

    // Act
    const key = globalizeWorkGraphKey(
      workGraphBackendKey(hosted, null),
      "run:a1",
    );

    // Assert
    expect(parseWorkGraphKey(key as string)).toMatchObject({
      status: "resolved",
      backendKey: "local:example.com%2Fcanvas",
      kindToken: "run",
      id: "a1",
    });
  });
});
