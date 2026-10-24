/**
 * Fold several deployments' work-graph answers into one graph.
 *
 * Every deployment answers only about itself. It cannot see another
 * deployment's runs, cannot see another deployment's claims, and names its own
 * work with keys that are unique only to itself. So the merge has four jobs:
 *
 *  1. put each deployment's keys into the global grammar, so two deployments
 *     cannot collide;
 *  2. collapse the nodes that are genuinely one thing — a repository, a cited
 *     source, a pull request — into one node that remembers which deployments
 *     reported it;
 *  3. say out loud what it had to leave out or could not place, because a
 *     graph that quietly drops work is worse than no graph; and
 *  4. hand a *finite, acyclic* delegation structure to whatever lays this out,
 *     since a cycle in `delegates` would hang a depth-first layout rather than
 *     draw something wrong and visible.
 *
 * The one genuinely interesting finding falls out of (2): because no
 * deployment can see another's claims, two deployments can each have a cycle
 * in flight against the same repository and neither will ever know. Once their
 * repository nodes collapse, that collision is visible here and nowhere else,
 * so it is reported as a finding rather than left to look like a drawing
 * artifact.
 */

import {
  WORK_GRAPH_BACKEND_NODE_KIND,
  WORK_GRAPH_SCHEMA_VERSION,
  type MergedWorkGraphNodeKind,
  type WorkGraphClientOmissionKind,
  type WorkGraphEdgeKind,
  type WorkGraphNode,
  type WorkGraphOmissionKind,
  type WorkGraphResponse,
  type WorkGraphStatus,
} from "#/types/work-graph";
import {
  globalizeWorkGraphKey,
  workGraphBackendNodeKey,
} from "./work-graph-key";

/** Where one deployment's contribution stands. */
export const WORK_GRAPH_CONTRIBUTION_STATES = [
  /** It answered; `response` carries its subgraph. */
  "answered",
  /** No answer yet. Nothing is missing — it has not arrived. */
  "pending",
  /** It could not be asked, or the request failed. */
  "unreachable",
] as const;

export type WorkGraphContributionState =
  (typeof WORK_GRAPH_CONTRIBUTION_STATES)[number];

/** One deployment's part in the merge. */
export interface WorkGraphContribution {
  /** From `workGraphBackendKey` — never a `Backend.id`. */
  backendKey: string;
  /** The registry id, so a node can be traced back to its backend record. */
  backendId: string;
  /** The user's name for this deployment; the backend node's label. */
  backendName: string;
  state: WorkGraphContributionState;
  /** Its subgraph, when `state` is `answered`. */
  response?: WorkGraphResponse | null;
  /** Why it could not be asked, when something said why. */
  error?: string | null;
}

export interface MergedWorkGraphNode {
  /** Global key — see `work-graph-key.ts`. */
  key: string;
  kind: MergedWorkGraphNodeKind;
  label: string;
  status: WorkGraphStatus;
  startedAt: string | null;
  endedAt: string | null;
  /** `null` only for a node Canvas made that nobody has observed yet. */
  updatedAt: string | null;
  attrs: Record<string, unknown>;
  /**
   * Every deployment that reported this node. More than one is only possible
   * for a content-addressed node, and is exactly what makes a cross-deployment
   * collision visible.
   */
  backendKeys: string[];
}

export interface MergedWorkGraphEdge {
  kind: WorkGraphEdgeKind;
  from: string;
  to: string;
  backendKeys: string[];
}

export interface MergedWorkGraphOmission {
  kind: WorkGraphOmissionKind | WorkGraphClientOmissionKind;
  /** Whose view of the work this is missing from. */
  backendKey: string;
  /** Global key of the thing left out, when one was named and parseable. */
  key: string | null;
  /**
   * The service's own prose, or a transport error. `null` for an omission
   * Canvas raised itself — the UI words those, so this layer ships no copy.
   */
  detail: string | null;
}

export const WORK_GRAPH_FINDING_KINDS = [
  /** Two deployments are working the same repository and cannot know it. */
  "concurrent_claim",
  /** A `delegates` cycle was broken so a layout cannot hang on it. */
  "delegation_cycle",
  /** An edge named a node that is not in the graph, so it cannot be drawn. */
  "dangling_edge",
  /** A key did not fit the grammar and was not turned into a node or edge. */
  "unresolved_key",
] as const;

export type WorkGraphFindingKind = (typeof WORK_GRAPH_FINDING_KINDS)[number];

export interface ConcurrentClaimFinding {
  kind: "concurrent_claim";
  repositoryKey: string;
  /** The in-flight cycles, one per deployment that has one. */
  claims: { backendKey: string; nodeKey: string }[];
}

export interface DelegationCycleFinding {
  kind: "delegation_cycle";
  /** The nodes around the cycle, with the entry node repeated at the end. */
  cycle: string[];
  /** The edge Canvas dropped to break it. */
  droppedEdge: { from: string; to: string };
}

export interface DanglingEdgeFinding {
  kind: "dangling_edge";
  edgeKind: WorkGraphEdgeKind;
  from: string;
  to: string;
  /** The endpoints with no node. */
  missing: string[];
}

export interface UnresolvedKeyFinding {
  kind: "unresolved_key";
  backendKey: string;
  /** The key exactly as the deployment sent it. */
  key: string;
}

export type WorkGraphFinding =
  | ConcurrentClaimFinding
  | DelegationCycleFinding
  | DanglingEdgeFinding
  | UnresolvedKeyFinding;

export interface MergedWorkGraph {
  nodes: MergedWorkGraphNode[];
  edges: MergedWorkGraphEdge[];
  omissions: MergedWorkGraphOmission[];
  findings: WorkGraphFinding[];
  /** Nodes working across every deployment. Non-zero is what drives polling. */
  inFlight: number;
  /** The newest `generated_at` among the answers, or `null` if none answered. */
  generatedAt: string | null;
}

/** Edge kinds that point work at a repository: see `WORK_GRAPH_EDGE_KINDS`. */
const CLAIMING_EDGE_KINDS: readonly WorkGraphEdgeKind[] = ["claims", "targets"];

const DELEGATES_EDGE_KIND: WorkGraphEdgeKind = "delegates";

const PROGRAM_NODE_KIND: MergedWorkGraphNodeKind = "program";

const REPOSITORY_NODE_KIND: MergedWorkGraphNodeKind = "repository";

const CYCLE_NODE_KIND: MergedWorkGraphNodeKind = "cycle";

const IN_FLIGHT_STATUS: WorkGraphStatus = "in_flight";

/** A node id is a URL as often as not, so edges are keyed on a NUL join. */
function edgeId(kind: string, from: string, to: string): string {
  return [kind, from, to].join("\u0000");
}

function timestampValue(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/** The earlier of two instants, where "never" loses to any real one. */
function earliestTimestamp(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return timestampValue(a) <= timestampValue(b) ? a : b;
}

function latestTimestamp(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return timestampValue(a) >= timestampValue(b) ? a : b;
}

function unionKeys(a: readonly string[], b: readonly string[]): string[] {
  return [...new Set([...a, ...b])];
}

/**
 * Combine two reports of one node.
 *
 * The fresher `updated_at` wins every field it has an opinion about, with two
 * exceptions:
 *
 *  - `in_flight` reported by a *different* deployment wins outright, because
 *    the union of two deployments' work is in flight if either part is, and a
 *    staler "done" from one must not hide live work on the other. Between two
 *    observations by the *same* deployment the fresher one is simply the
 *    truth, so a finished node does finish.
 *  - `startedAt` takes the earliest real start, and `endedAt` stays `null`
 *    while any reporter still has the node open: the collapsed node spans
 *    everything that happened to the thing it names.
 */
function mergeNodes(
  existing: MergedWorkGraphNode,
  incoming: MergedWorkGraphNode,
): MergedWorkGraphNode {
  const incomingIsFresher =
    timestampValue(incoming.updatedAt) > timestampValue(existing.updatedAt);
  const fresher = incomingIsFresher ? incoming : existing;
  const staler = incomingIsFresher ? existing : incoming;
  const sameDeployment = incoming.backendKeys.every((key) =>
    existing.backendKeys.includes(key),
  );
  const eitherInFlight =
    existing.status === IN_FLIGHT_STATUS ||
    incoming.status === IN_FLIGHT_STATUS;

  return {
    key: existing.key,
    kind: fresher.kind,
    label: fresher.label || staler.label,
    status:
      !sameDeployment && eitherInFlight ? IN_FLIGHT_STATUS : fresher.status,
    startedAt: earliestTimestamp(existing.startedAt, incoming.startedAt),
    endedAt:
      existing.endedAt === null || incoming.endedAt === null
        ? null
        : latestTimestamp(existing.endedAt, incoming.endedAt),
    updatedAt: fresher.updatedAt,
    attrs: { ...staler.attrs, ...fresher.attrs },
    backendKeys: unionKeys(existing.backendKeys, incoming.backendKeys),
  };
}

function toMergedNode(
  key: string,
  node: WorkGraphNode,
  backendKey: string,
): MergedWorkGraphNode {
  return {
    key,
    kind: node.kind,
    label: node.label ?? "",
    status: node.status,
    startedAt: node.started_at ?? null,
    endedAt: node.ended_at ?? null,
    updatedAt: node.updated_at ?? null,
    attrs: node.attrs ?? {},
    backendKeys: [backendKey],
  };
}

/**
 * Whether this build can read the answer at all.
 *
 * A subgraph in a schema version this build does not know is refused rather
 * than read optimistically: the fields may mean something else in that
 * version, and a confident, wrong picture of what the agents are doing is
 * worse than a stated gap. A payload with no version at all is read — that is
 * a malformed response, not a new contract, and the merge tolerates those
 * field by field.
 */
function isReadableResponse(response: WorkGraphResponse): boolean {
  return (
    response.schema_version === undefined ||
    response.schema_version === null ||
    response.schema_version === WORK_GRAPH_SCHEMA_VERSION
  );
}

/**
 * The node that stands for a deployment.
 *
 * Its status says whether the deployment is answering and whether anything is
 * running on it: `unreachable` when Canvas could not ask, `pending` before the
 * first answer, `failed` when it answered something unreadable, `in_flight`
 * while it reports work, and `done` when it is reachable and idle.
 */
function backendNodeFor(
  contribution: WorkGraphContribution,
): MergedWorkGraphNode {
  const { response } = contribution;
  let status: WorkGraphStatus;
  if (contribution.state === "unreachable") status = "unreachable";
  else if (contribution.state === "pending") status = "pending";
  else if (response && !isReadableResponse(response)) status = "failed";
  else status = (response?.in_flight ?? 0) > 0 ? IN_FLIGHT_STATUS : "done";

  return {
    key: workGraphBackendNodeKey(contribution.backendKey),
    kind: WORK_GRAPH_BACKEND_NODE_KIND,
    label: contribution.backendName,
    status,
    startedAt: null,
    endedAt: null,
    updatedAt: response?.generated_at ?? null,
    // Canvas authored this node, so its attrs are camelCase: a reader can tell
    // them from the service's own snake_case payload at a glance.
    attrs: {
      backendId: contribution.backendId,
      serviceId: response?.service_id ?? null,
      orgId: response?.org_id ?? null,
    },
    backendKeys: [contribution.backendKey],
  };
}

interface MergeState {
  nodes: Map<string, MergedWorkGraphNode>;
  edges: Map<string, MergedWorkGraphEdge>;
  omissions: MergedWorkGraphOmission[];
  findings: WorkGraphFinding[];
}

function upsertNode(state: MergeState, node: MergedWorkGraphNode): void {
  const existing = state.nodes.get(node.key);
  state.nodes.set(node.key, existing ? mergeNodes(existing, node) : node);
}

function upsertEdge(
  state: MergeState,
  edge: Omit<MergedWorkGraphEdge, "backendKeys">,
  backendKey: string,
): void {
  const id = edgeId(edge.kind, edge.from, edge.to);
  const existing = state.edges.get(id);
  state.edges.set(id, {
    ...edge,
    backendKeys: existing
      ? unionKeys(existing.backendKeys, [backendKey])
      : [backendKey],
  });
}

/**
 * Apply a delta's `removed` list.
 *
 * A content-addressed node another deployment still reports is kept, minus the
 * reporter that dropped it — one deployment forgetting a repository does not
 * make the repository go away. A node that no reporter is left for goes, and
 * every edge touching it goes with it, whoever reported those: an edge to a
 * node that is not there cannot be drawn.
 */
function removeNode(state: MergeState, key: string, backendKey: string): void {
  const existing = state.nodes.get(key);
  if (!existing) return;

  const remaining = existing.backendKeys.filter((k) => k !== backendKey);
  if (remaining.length > 0) {
    state.nodes.set(key, { ...existing, backendKeys: remaining });
    return;
  }

  state.nodes.delete(key);
  for (const [id, edge] of [...state.edges]) {
    if (edge.from === key || edge.to === key) state.edges.delete(id);
  }
}

function addContribution(
  state: MergeState,
  contribution: WorkGraphContribution,
): void {
  const { backendKey, response } = contribution;
  const backendNode = backendNodeFor(contribution);
  // Replaced, not merged: this node has one writer and describes the present,
  // so a state carried forward from an earlier merge must never outrank a
  // fresher "this deployment is not answering".
  state.nodes.set(backendNode.key, backendNode);

  if (contribution.state === "unreachable") {
    // Reported, never silently absent: a backend missing from the graph would
    // be indistinguishable from a backend with nothing to do.
    state.omissions.push({
      kind: "backend_unreachable",
      backendKey,
      key: backendNode.key,
      detail: contribution.error ?? null,
    });
    return;
  }

  if (contribution.state !== "answered" || !response) return;

  if (!isReadableResponse(response)) {
    state.omissions.push({
      kind: "schema_unsupported",
      backendKey,
      key: backendNode.key,
      detail: null,
    });
    return;
  }

  for (const node of response.nodes ?? []) {
    if (typeof node?.key !== "string") {
      state.findings.push({
        kind: "unresolved_key",
        backendKey,
        key: String(node?.key ?? ""),
      });
      continue;
    }
    const key = globalizeWorkGraphKey(backendKey, node.key);
    if (!key) {
      state.findings.push({
        kind: "unresolved_key",
        backendKey,
        key: node.key,
      });
      continue;
    }
    upsertNode(state, toMergedNode(key, node, backendKey));

    // `hosts` is in the edge vocabulary but no node kind can host anything, so
    // the deployment node is where it has to start. A program is the root of a
    // deployment's work, which makes it the honest other end — and it keeps a
    // deployment with no work from floating unconnected on the canvas.
    if (node.kind === PROGRAM_NODE_KIND) {
      upsertEdge(
        state,
        { kind: "hosts", from: backendNode.key, to: key },
        backendKey,
      );
    }
  }

  for (const edge of response.edges ?? []) {
    const from = globalizeWorkGraphKey(backendKey, edge?.from ?? "");
    const to = globalizeWorkGraphKey(backendKey, edge?.to ?? "");
    if (!from || !to) {
      state.findings.push({
        kind: "unresolved_key",
        backendKey,
        key: from ? (edge?.to ?? "") : (edge?.from ?? ""),
      });
      continue;
    }
    upsertEdge(state, { kind: edge.kind, from, to }, backendKey);
  }

  for (const removed of response.removed ?? []) {
    const key = globalizeWorkGraphKey(backendKey, removed ?? "");
    if (key) removeNode(state, key, backendKey);
  }

  for (const omission of response.omissions ?? []) {
    state.omissions.push({
      kind: omission.kind,
      backendKey,
      key: omission.key
        ? globalizeWorkGraphKey(backendKey, omission.key)
        : null,
      detail: omission.detail ?? null,
    });
  }

  // `has_more` means the window cut work off. A service that also says so in
  // `omissions` is taken at its word; one that only sets the flag still gets
  // the truncation on the record.
  const saysTruncated = (response.omissions ?? []).some(
    (omission) => omission.kind === "window_truncated",
  );
  if (response.has_more && !saysTruncated) {
    state.omissions.push({
      kind: "window_truncated",
      backendKey,
      key: null,
      detail: null,
    });
  }
}

/** Drop edges that name a node nobody reported, and say which. */
function dropDanglingEdges(state: MergeState): void {
  for (const [id, edge] of [...state.edges]) {
    const missing = [edge.from, edge.to].filter(
      (endpoint) => !state.nodes.has(endpoint),
    );
    if (missing.length === 0) continue;
    state.edges.delete(id);
    state.findings.push({
      kind: "dangling_edge",
      edgeKind: edge.kind,
      from: edge.from,
      to: edge.to,
      missing,
    });
  }
}

/**
 * Break every cycle in the `delegates` relation, reporting each one.
 *
 * Delegation is a tree in every design of it, so a cycle here means something
 * upstream is wrong — but a depth-first layout given one would recurse until
 * the tab dies, which hides the bug behind a hang. Dropping the back edge
 * leaves a drawable graph and a finding that names the loop.
 */
function breakDelegationCycles(state: MergeState): void {
  const adjacency = new Map<string, { to: string; id: string }[]>();
  for (const [id, edge] of state.edges) {
    if (edge.kind !== DELEGATES_EDGE_KIND) continue;
    const outgoing = adjacency.get(edge.from) ?? [];
    outgoing.push({ to: edge.to, id });
    adjacency.set(edge.from, outgoing);
  }
  if (adjacency.size === 0) return;

  // `on-stack` is the node's own ancestry in this walk, which is what makes an
  // edge back into it a cycle rather than a second route to the same node.
  const visits = new Map<string, "on-stack" | "done">();
  const stack: string[] = [];

  const visit = (key: string): void => {
    visits.set(key, "on-stack");
    stack.push(key);
    for (const { to, id } of adjacency.get(key) ?? []) {
      if (!state.edges.has(id)) continue;
      const seen = visits.get(to);
      if (seen === "on-stack") {
        state.edges.delete(id);
        state.findings.push({
          kind: "delegation_cycle",
          cycle: [...stack.slice(stack.indexOf(to)), to],
          droppedEdge: { from: key, to },
        });
      } else if (seen === undefined) {
        visit(to);
      }
    }
    stack.pop();
    visits.set(key, "done");
  };

  // Node insertion order, so the same input always breaks the same edge.
  for (const key of state.nodes.keys()) {
    if (!visits.has(key)) visit(key);
  }
}

/**
 * Report repositories that two deployments are working at the same time.
 *
 * No deployment can see another's claims, so neither side can detect this and
 * neither will back off. It only becomes visible once their content-addressed
 * repository nodes collapse into one, which happens here.
 */
function findConcurrentClaims(state: MergeState): void {
  const claimsByRepository = new Map<
    string,
    { backendKey: string; nodeKey: string }[]
  >();

  for (const edge of state.edges.values()) {
    if (!CLAIMING_EDGE_KINDS.includes(edge.kind)) continue;
    const claimant = state.nodes.get(edge.from);
    const repository = state.nodes.get(edge.to);
    if (!claimant || !repository) continue;
    if (
      claimant.kind !== CYCLE_NODE_KIND ||
      claimant.status !== IN_FLIGHT_STATUS
    ) {
      continue;
    }
    if (repository.kind !== REPOSITORY_NODE_KIND) continue;

    const claims = claimsByRepository.get(edge.to) ?? [];
    for (const backendKey of claimant.backendKeys) {
      const alreadyRecorded = claims.some(
        (claim) =>
          claim.backendKey === backendKey && claim.nodeKey === claimant.key,
      );
      if (!alreadyRecorded) claims.push({ backendKey, nodeKey: claimant.key });
    }
    claimsByRepository.set(edge.to, claims);
  }

  for (const [repositoryKey, claims] of claimsByRepository) {
    const deployments = new Set(claims.map((claim) => claim.backendKey));
    if (deployments.size < 2) continue;
    state.findings.push({
      kind: "concurrent_claim",
      repositoryKey,
      claims,
    });
  }
}

/**
 * Merge the contributions into one graph.
 *
 * `previous` lets a delta build on what is already drawn: its nodes and edges
 * are carried forward, anything re-reported is merged over them, and anything
 * in a delta's `removed` is taken out. Omissions and findings are not carried
 * forward — they describe the answers in hand, not the picture.
 */
export function mergeWorkGraphs(
  contributions: readonly WorkGraphContribution[],
  previous?: MergedWorkGraph | null,
): MergedWorkGraph {
  const state: MergeState = {
    nodes: new Map((previous?.nodes ?? []).map((node) => [node.key, node])),
    edges: new Map(
      (previous?.edges ?? []).map((edge) => [
        edgeId(edge.kind, edge.from, edge.to),
        edge,
      ]),
    ),
    omissions: [],
    findings: [],
  };

  let inFlight = 0;
  let generatedAt: string | null = null;

  for (const contribution of contributions) {
    addContribution(state, contribution);
    const { response } = contribution;
    if (contribution.state !== "answered" || !response) continue;
    // An answer this build cannot read says nothing about what is running, so
    // it must not keep the poll alive either.
    if (!isReadableResponse(response)) continue;
    if (Number.isFinite(response.in_flight)) inFlight += response.in_flight;
    generatedAt = latestTimestamp(generatedAt, response.generated_at ?? null);
  }

  dropDanglingEdges(state);
  breakDelegationCycles(state);
  findConcurrentClaims(state);

  return {
    nodes: [...state.nodes.values()],
    edges: [...state.edges.values()],
    omissions: state.omissions,
    findings: state.findings,
    inFlight,
    generatedAt,
  };
}
