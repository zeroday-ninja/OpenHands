/**
 * The export milestone 3's exit asks for, and the properties it asks of it.
 *
 * The graph, its key grammar, its merge and its omissions were all built. The
 * export — "canonical, sorted, byte-reproducible, with a digest anyone can
 * recompute and a mandatory omissions list", and across backends "a bundle of
 * independent attestations" that "must say so" — was not, so
 * *"the export reproduces byte-identically twice"* had nothing to reproduce.
 */

import { describe, expect, it } from "vitest";
import type {
  WorkGraphNode,
  WorkGraphNodeKind,
  WorkGraphResponse,
} from "#/types/work-graph";
import {
  mergeWorkGraphs,
  type WorkGraphContribution,
} from "#/utils/work-graph/work-graph-merge";
import {
  canonicalWorkGraphDocument,
  workGraphDigest,
  workGraphExport,
} from "#/utils/work-graph/work-graph-export";

const ALPHA = "local:alpha.example.com";
const BETA = "local:beta.example.com";
const REPO_KEY = "repo:https://github.com/acme/app@main";

function node(
  key: string,
  kind: WorkGraphNodeKind,
  overrides: Partial<WorkGraphNode> = {},
): WorkGraphNode {
  return {
    key,
    kind,
    label: key,
    status: "done",
    started_at: null,
    ended_at: null,
    updated_at: "2026-10-24T08:00:00Z",
    attrs: {},
    ...overrides,
  };
}

function response(
  overrides: Partial<WorkGraphResponse> = {},
): WorkGraphResponse {
  return {
    schema_version: 1,
    service_id: "service",
    org_id: null,
    generated_at: "2026-10-24T08:00:00Z",
    cursor: "cursor-1",
    has_more: false,
    in_flight: 0,
    nodes: [],
    edges: [],
    ...overrides,
  };
}

function answered(
  backendKey: string,
  subgraph: WorkGraphResponse,
): WorkGraphContribution {
  return {
    backendKey,
    backendId: `${backendKey}-registry-id`,
    backendName: backendKey,
    state: "answered",
    response: subgraph,
  };
}

/** Two deployments, each with its own cycle against the same repository. */
function twoBackends(): WorkGraphContribution[] {
  return [
    answered(
      ALPHA,
      response({
        nodes: [node("cycle:a1", "cycle"), node(REPO_KEY, "repository")],
        edges: [{ kind: "targets", from: "cycle:a1", to: REPO_KEY }],
        omissions: [
          {
            kind: "cycle_reaped",
            key: "cycle:a1",
            detail: "its sandbox was deleted",
          },
        ],
      }),
    ),
    answered(
      BETA,
      response({
        nodes: [node("cycle:b1", "cycle"), node(REPO_KEY, "repository")],
        edges: [{ kind: "targets", from: "cycle:b1", to: REPO_KEY }],
      }),
    ),
  ];
}

describe("exporting the work graph", () => {
  it("reproduces byte-identically, and the digest matches the bytes", async () => {
    // Arrange: the same graph, merged twice.
    const contributions = twoBackends();

    // Act
    const first = canonicalWorkGraphDocument(
      workGraphExport(mergeWorkGraphs(contributions), contributions),
    );
    const second = canonicalWorkGraphDocument(
      workGraphExport(mergeWorkGraphs(contributions), contributions),
    );

    // Assert: the same bytes, so a digest over them means something — and
    // nothing from the moment of export is in the document, which is what
    // would otherwise change it on every call.
    expect(first).toBe(second);
    expect(first).not.toMatch(/exportedAt|requestedBy/);
    expect(await workGraphDigest(first)).toBe(await workGraphDigest(second));
    expect(await workGraphDigest(first)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("is the same bytes whichever order the deployments answered in", async () => {
    // Two machines asking the same two backends must be able to compare
    // digests. If the order a fan-out happened to complete in changed the
    // document, they never could.
    const contributions = twoBackends();
    const forwards = workGraphExport(
      mergeWorkGraphs(contributions),
      contributions,
    );
    const reversed = [...contributions].reverse();
    const backwards = workGraphExport(mergeWorkGraphs(reversed), reversed);

    expect(canonicalWorkGraphDocument(forwards)).toBe(
      canonicalWorkGraphDocument(backwards),
    );
  });

  it("says it is a bundle, and names what each deployment contributed", () => {
    // Several deployments cannot attest to one another's work: each answered
    // for itself and none of them can see the others. A reader has to be told
    // which of the two they are holding.
    const contributions = twoBackends();

    const exported = workGraphExport(
      mergeWorkGraphs(contributions),
      contributions,
    );

    expect(exported.form).toBe("bundle");
    expect(exported.attestations.map((one) => one.backendKey)).toEqual([
      ALPHA,
      BETA,
    ]);
    expect(exported.attestations[0].nodes).toBe(2);
  });

  it("calls one deployment's answer an attestation, not a bundle", () => {
    const [only] = twoBackends();

    const exported = workGraphExport(mergeWorkGraphs([only]), [only]);

    expect(exported.form).toBe("attestation");
  });

  it("stays a bundle when a deployment could not be asked, and says which", () => {
    // An absent backend and a backend with no work are the same empty space
    // otherwise, and calling this an attestation would claim a completeness
    // nobody has.
    const [alpha] = twoBackends();
    const unreachable: WorkGraphContribution = {
      backendKey: BETA,
      backendId: "beta-registry-id",
      backendName: BETA,
      state: "unreachable",
      error: "connect ECONNREFUSED",
    };
    const contributions = [alpha, unreachable];

    const exported = workGraphExport(
      mergeWorkGraphs(contributions),
      contributions,
    );

    expect(exported.form).toBe("bundle");
    const beta = exported.attestations.find((one) => one.backendKey === BETA);
    expect(beta?.state).toBe("unreachable");
    expect(beta?.error).toBe("connect ECONNREFUSED");
    expect(beta?.nodes).toBe(0);
  });

  it("always carries an omissions list, empty or not", () => {
    // A document with no omissions key is indistinguishable from one written
    // by a build that did not record them, which is the difference between
    // "nothing was left out" and "nobody looked".
    const clean = [
      answered(ALPHA, response({ nodes: [node("cycle:a1", "cycle")] })),
    ];

    const exported = workGraphExport(mergeWorkGraphs(clean), clean);
    const withOmissions = (() => {
      const contributions = twoBackends();
      return workGraphExport(mergeWorkGraphs(contributions), contributions);
    })();

    expect(exported.omissions).toEqual([]);
    expect(canonicalWorkGraphDocument(exported)).toContain('"omissions": []');
    expect(withOmissions.omissions.length).toBeGreaterThan(0);
  });
});
