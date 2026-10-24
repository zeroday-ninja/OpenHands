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

const ALPHA = "local:alpha.example.com";
const BETA = "local:beta.example.com";
const REPO_KEY = "repo:https://github.com/acme/app@main";
const REPO_GLOBAL = `oh:1//${REPO_KEY}`;

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

/** The same repository, as each deployment reports its own work against it. */
function repositoryContribution(
  backendKey: string,
  cycleKey: string,
  cycleStatus: WorkGraphNode["status"],
  repoOverrides: Partial<WorkGraphNode>,
): WorkGraphContribution {
  return answered(
    backendKey,
    response({
      nodes: [
        node(cycleKey, "cycle", { status: cycleStatus }),
        node(REPO_KEY, "repository", repoOverrides),
      ],
      edges: [{ kind: "targets", from: cycleKey, to: REPO_KEY }],
      in_flight: cycleStatus === "in_flight" ? 1 : 0,
    }),
  );
}

describe("mergeWorkGraphs", () => {
  it("collapses a repository both deployments report into one node, keeping the earliest start and the latest update", () => {
    // Arrange
    const alpha = repositoryContribution(ALPHA, "cycle:a1", "done", {
      started_at: "2026-10-01T00:00:00Z",
      updated_at: "2026-10-23T00:00:00Z",
      label: "app",
    });
    const beta = repositoryContribution(BETA, "cycle:b1", "done", {
      started_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-10-24T09:00:00Z",
      label: "acme/app",
    });

    // Act
    const graph = mergeWorkGraphs([alpha, beta]);

    // Assert: one repository, both reporters recorded, and the span of
    // everything that happened to it.
    const repositories = graph.nodes.filter((n) => n.kind === "repository");
    expect(repositories).toHaveLength(1);
    expect(repositories[0]).toMatchObject({
      key: REPO_GLOBAL,
      label: "acme/app",
      startedAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-10-24T09:00:00Z",
      backendKeys: [ALPHA, BETA],
    });
    expect(
      graph.edges.filter(
        (edge) => edge.kind === "targets" && edge.to === REPO_GLOBAL,
      ),
    ).toEqual([
      expect.objectContaining({ from: `oh:1/${ALPHA}/cycle:a1` }),
      expect.objectContaining({ from: `oh:1/${BETA}/cycle:b1` }),
    ]);
    expect(graph.findings).toEqual([]);
  });

  it("flags two deployments running a cycle against the same repository at once", () => {
    // Arrange: neither service can see the other's claim, so neither will
    // ever report this itself.
    const alpha = repositoryContribution(ALPHA, "cycle:a1", "in_flight", {});
    const beta = repositoryContribution(BETA, "cycle:b1", "in_flight", {});

    // Act
    const graph = mergeWorkGraphs([alpha, beta]);

    // Assert
    expect(graph.findings).toEqual([
      {
        kind: "concurrent_claim",
        repositoryKey: REPO_GLOBAL,
        claims: [
          { backendKey: ALPHA, nodeKey: `oh:1/${ALPHA}/cycle:a1` },
          { backendKey: BETA, nodeKey: `oh:1/${BETA}/cycle:b1` },
        ],
      },
    ]);
    expect(graph.inFlight).toBe(2);
  });

  it("breaks a cycle in delegates and reports the loop instead of handing it to a layout", () => {
    // Arrange: a delegation loop, which a depth-first layout would recurse on
    // until the tab dies.
    const contribution = answered(
      ALPHA,
      response({
        nodes: [
          node("agent:a", "agent"),
          node("agent:b", "agent"),
          node("agent:c", "agent"),
        ],
        edges: [
          { kind: "delegates", from: "agent:a", to: "agent:b" },
          { kind: "delegates", from: "agent:b", to: "agent:c" },
          { kind: "delegates", from: "agent:c", to: "agent:a" },
        ],
      }),
    );

    // Act
    const graph = mergeWorkGraphs([contribution]);

    // Assert: one edge dropped, the agents all still drawn, and the loop named.
    expect(
      graph.edges.filter((edge) => edge.kind === "delegates"),
    ).toHaveLength(2);
    expect(graph.nodes.filter((n) => n.kind === "agent")).toHaveLength(3);
    expect(graph.findings).toEqual([
      {
        kind: "delegation_cycle",
        cycle: [
          `oh:1/${ALPHA}/agent:a`,
          `oh:1/${ALPHA}/agent:b`,
          `oh:1/${ALPHA}/agent:c`,
          `oh:1/${ALPHA}/agent:a`,
        ],
        droppedEdge: {
          from: `oh:1/${ALPHA}/agent:c`,
          to: `oh:1/${ALPHA}/agent:a`,
        },
      },
    ]);
  });

  it("takes out what a delta reports as removed, and the edges that pointed at it", () => {
    // Arrange: a graph already on screen, then a delta that drops one cycle.
    const previous = mergeWorkGraphs([
      repositoryContribution(ALPHA, "cycle:a1", "done", {}),
    ]);

    // Act
    const graph = mergeWorkGraphs(
      [answered(ALPHA, response({ removed: ["cycle:a1"] }))],
      previous,
    );

    // Assert: the cycle and its edge are gone; the repository it worked on is
    // still there, because a delta reports changes, not the whole window.
    expect(graph.nodes.map((n) => n.key)).not.toContain(
      `oh:1/${ALPHA}/cycle:a1`,
    );
    expect(graph.nodes.map((n) => n.key)).toContain(REPO_GLOBAL);
    expect(graph.edges).toEqual([]);
  });

  it("replaces a deployment's own node instead of merging what it used to be", () => {
    // Arrange: it was working a moment ago, and is now not answering.
    const previous = mergeWorkGraphs([
      answered(ALPHA, response({ in_flight: 1 })),
    ]);

    // Act
    const graph = mergeWorkGraphs(
      [
        {
          backendKey: ALPHA,
          backendId: `${ALPHA}-registry-id`,
          backendName: ALPHA,
          state: "unreachable",
          error: "ECONNREFUSED",
        },
      ],
      previous,
    );

    // Assert: the stale "working" must not outrank the current silence.
    expect(graph.nodes).toEqual([
      expect.objectContaining({ kind: "backend", status: "unreachable" }),
    ]);
  });

  it("connects each deployment to the programs it hosts", () => {
    // Arrange
    const contribution = answered(
      ALPHA,
      response({ nodes: [node("program:p1", "program")] }),
    );

    // Act
    const graph = mergeWorkGraphs([contribution]);

    // Assert: `hosts` can only start at the deployment, and a deployment node
    // that connects to nothing is a dot on a canvas.
    expect(graph.edges).toEqual([
      expect.objectContaining({
        kind: "hosts",
        from: `oh:1/${ALPHA}/backend:self`,
        to: `oh:1/${ALPHA}/program:p1`,
      }),
    ]);
  });

  it("refuses a subgraph whose schema version it cannot read, and says whose it was", () => {
    // Arrange: a future schema, where today's field names may mean something
    // else. A confident wrong picture of autonomous work is the failure to
    // avoid here.
    const contribution = answered(
      ALPHA,
      response({
        schema_version: 2,
        in_flight: 3,
        nodes: [node("cycle:a1", "cycle", { status: "in_flight" })],
      }),
    );

    // Act
    const graph = mergeWorkGraphs([contribution]);

    // Assert
    expect(graph.nodes).toEqual([
      expect.objectContaining({ kind: "backend", status: "failed" }),
    ]);
    expect(graph.omissions).toEqual([
      {
        kind: "schema_unsupported",
        backendKey: ALPHA,
        key: `oh:1/${ALPHA}/backend:self`,
        detail: null,
      },
    ]);
    expect(graph.inFlight).toBe(0);
  });

  it("reports the keys and edges it could not place rather than dropping them quietly", () => {
    // Arrange: a node key that is not `<kind>:<id>` at all, and an edge whose
    // ends are outside the window the service sent.
    const contribution = answered(
      ALPHA,
      response({
        nodes: [node("nocolon", "run")],
        edges: [{ kind: "produces", from: "run:r1", to: "artifact:x1" }],
      }),
    );

    // Act
    const graph = mergeWorkGraphs([contribution]);

    // Assert
    expect(graph.edges).toEqual([]);
    expect(graph.findings).toEqual([
      { kind: "unresolved_key", backendKey: ALPHA, key: "nocolon" },
      {
        kind: "dangling_edge",
        edgeKind: "produces",
        from: `oh:1/${ALPHA}/run:r1`,
        to: `oh:1/${ALPHA}/artifact:x1`,
        missing: [`oh:1/${ALPHA}/run:r1`, `oh:1/${ALPHA}/artifact:x1`],
      },
    ]);
  });

  it("records a truncated window even when the service only sets the flag", () => {
    // Arrange
    const contribution = answered(ALPHA, response({ has_more: true }));

    // Act
    const graph = mergeWorkGraphs([contribution]);

    // Assert
    expect(graph.omissions).toEqual([
      {
        kind: "window_truncated",
        backendKey: ALPHA,
        key: null,
        detail: null,
      },
    ]);
  });
});
