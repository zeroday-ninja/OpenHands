/**
 * The work graph: a live, auditable picture of autonomous work.
 *
 * Programs, their runs, the improvement cycles those runs claim, the agents
 * that built and reviewed each change, the repositories they touched, the
 * artifacts they produced and the sources they cited — as reported by every
 * registered deployment's `GET /api/automation/v1/work-graph`.
 *
 * The shapes below are the wire format and use snake_case, matching the rest
 * of this repository's server-facing types. Everything the client derives from
 * them (see `src/utils/work-graph/`) is camelCase, so a field name alone says
 * whether a deployment stated it or Canvas computed it.
 *
 * The graph is assembled on every fetch and is never written to disk. Run
 * status in a committed file would churn the repository on every poll and leak
 * deployment identity into source control.
 */

/** The only `schema_version` this build understands. */
export const WORK_GRAPH_SCHEMA_VERSION = 1;

/** The automation service's work-graph route, relative to the service root. */
export const WORK_GRAPH_PATH = "/v1/work-graph";

/** Days of history to ask for when a caller does not say. */
export const WORK_GRAPH_DEFAULT_WINDOW_DAYS = 7;

/** Nodes to ask one deployment for when a caller does not say. */
export const WORK_GRAPH_DEFAULT_LIMIT = 200;

/**
 * What a node *is*.
 *
 * `run-tombstone` is a run the service has already pruned: the row is gone but
 * the work happened, so the graph keeps a marker rather than quietly losing
 * the link between a program and what it produced.
 */
export const WORK_GRAPH_NODE_KINDS = [
  "program",
  "run",
  "run-tombstone",
  "cycle",
  "agent",
  "repository",
  "artifact",
  "source",
  "suggestion",
] as const;

export type WorkGraphNodeKind = (typeof WORK_GRAPH_NODE_KINDS)[number];

/**
 * What an edge *means*.
 *
 * `claims` and `targets` both point work at a repository — a cycle claims one
 * before any agent starts, a program targets the ones in its rotation — so a
 * reader of this graph must treat either as "this work is about that
 * repository".
 */
export const WORK_GRAPH_EDGE_KINDS = [
  "hosts",
  "schedules",
  "claims",
  "targets",
  "builds",
  "delegates",
  "forked-from",
  "produces",
  "reviews",
  "cites",
  "disputes",
  "verifies",
  "proposes",
] as const;

export type WorkGraphEdgeKind = (typeof WORK_GRAPH_EDGE_KINDS)[number];

/**
 * Where a node is in its life.
 *
 * `unreachable` is not a work outcome: it says the deployment that owns the
 * node could not be asked about it. Canvas uses the same value for a
 * deployment it was not allowed to ask (see the health circuit breaker in
 * `src/api/backend-registry/health-store.ts`), so an unanswered backend reads
 * identically whoever noticed.
 */
export const WORK_GRAPH_STATUSES = [
  "pending",
  "in_flight",
  "done",
  "failed",
  "abandoned",
  "pruned",
  "unreachable",
] as const;

export type WorkGraphStatus = (typeof WORK_GRAPH_STATUSES)[number];

/** Why a deployment left something out of the subgraph it sent. */
export const WORK_GRAPH_OMISSION_KINDS = [
  "run_pruned",
  "conversation_unreachable",
  "cycle_reaped",
  "window_truncated",
] as const;

export type WorkGraphOmissionKind = (typeof WORK_GRAPH_OMISSION_KINDS)[number];

/**
 * Why Canvas itself left a deployment's work out. Kept apart from the service's
 * own kinds above so a reader can tell "the service dropped this" from "the
 * browser never got to ask".
 */
export const WORK_GRAPH_CLIENT_OMISSION_KINDS = [
  /** Canvas was not allowed to ask, or asking failed. */
  "backend_unreachable",
  /** It answered in a schema version this build cannot read. */
  "schema_unsupported",
] as const;

export type WorkGraphClientOmissionKind =
  (typeof WORK_GRAPH_CLIENT_OMISSION_KINDS)[number];

/**
 * One node as a deployment reports it. `key` is backend-relative
 * (`<kind token>:<id>`) and only unique within that deployment; see
 * `src/utils/work-graph/work-graph-key.ts` for the global form.
 */
export interface WorkGraphNode {
  key: string;
  kind: WorkGraphNodeKind;
  label: string;
  status: WorkGraphStatus;
  started_at: string | null;
  ended_at: string | null;
  updated_at: string;
  /** Kind-specific, free-form. Never interpreted by the merge layer. */
  attrs: Record<string, unknown>;
}

/** One edge as a deployment reports it, between two backend-relative keys. */
export interface WorkGraphEdge {
  kind: WorkGraphEdgeKind;
  from: string;
  to: string;
}

export interface WorkGraphOmission {
  kind: WorkGraphOmissionKind;
  /** The backend-relative key of the thing left out, when there is one. */
  key: string | null;
  detail: string;
}

/** One deployment's answer to a work-graph request. */
export interface WorkGraphResponse {
  schema_version: number;
  /** This deployment's own identity, as it names itself. */
  service_id: string;
  org_id: string | null;
  generated_at: string;
  /** Opaque; pass back as `since` to ask for a delta. */
  cursor: string;
  has_more: boolean;
  /** Nodes currently working. Non-zero is what makes Canvas poll. */
  in_flight: number;
  nodes: WorkGraphNode[];
  edges: WorkGraphEdge[];
  /** Keys the delta dropped. Delta mode only. */
  removed?: string[];
  omissions?: WorkGraphOmission[];
}

/** What one work-graph request asks for. */
export interface WorkGraphRequestParams {
  /** A `cursor` from a previous answer, to ask for a delta instead of a window. */
  since?: string | null;
  windowDays?: number;
  limit?: number;
}

/*
 * ---------------------------------------------------------------------------
 * Key grammar
 * ---------------------------------------------------------------------------
 *
 * A node's global key is `oh:<version>/<backendKey>/<kind token>:<id>`, and
 * content-addressed nodes carry no backend part at all
 * (`oh:1//repo:<url>@<ref>`).
 *
 * The version is in the string because these keys are written into committed
 * project-map annotations: a key from a grammar this build does not know must
 * be reported as unresolved rather than re-matched against a node it may no
 * longer mean.
 */

/** Namespace, so a key is recognisable in a file full of other ids. */
export const WORK_GRAPH_KEY_NAMESPACE = "oh";

/** The grammar version this build writes. */
export const WORK_GRAPH_KEY_VERSION = 1;

/** Separates the namespace/version pair from the rest of the key. */
export const WORK_GRAPH_KEY_SEPARATOR = "/";

/** Separates a key's kind token from its id. */
export const WORK_GRAPH_KEY_TOKEN_SEPARATOR = ":";

/** `oh:1` — the literal every key this build writes starts with. */
export const WORK_GRAPH_KEY_PREFIX = `${WORK_GRAPH_KEY_NAMESPACE}${WORK_GRAPH_KEY_TOKEN_SEPARATOR}${WORK_GRAPH_KEY_VERSION}`;

/**
 * Kind tokens whose id names the same thing in every deployment, so two
 * deployments reporting one are reporting one node.
 *
 * Addressing is decided by the token alone and never by a node's `kind`: an
 * edge endpoint is just a key, with no kind beside it, so a rule that needed
 * the node payload would address the same thing two ways and leave the edge
 * dangling. `repo` and `repository` are both accepted because the token is the
 * service's abbreviation of the kind, not the kind itself.
 */
export const CONTENT_ADDRESSED_KEY_TOKENS = [
  "repo",
  "repository",
  "source",
  "pr",
] as const;

/**
 * An artifact id with this prefix is a pull request, which exists outside any
 * one deployment. Covers the `artifact:pr:<id>` spelling of the `pr:<id>` key.
 */
export const CONTENT_ADDRESSED_ARTIFACT_ID_PREFIX = "pr:";

/** The kind token of an artifact, for the spelling above. */
export const WORK_GRAPH_ARTIFACT_KEY_TOKEN = "artifact";

/**
 * Canvas's own node kind: one per registered backend, so a deployment is in
 * the graph whether or not it reported any work. A backend missing from the
 * graph would be indistinguishable from a backend with nothing to do.
 */
export const WORK_GRAPH_BACKEND_NODE_KIND = "backend";

/**
 * The id of a backend node. The key's backend part already identifies the
 * deployment, so the id is a constant rather than a repeat of it.
 */
export const WORK_GRAPH_BACKEND_NODE_ID = "self";

/** Node kinds a merged graph can contain: the service's, plus Canvas's own. */
export type MergedWorkGraphNodeKind =
  | WorkGraphNodeKind
  | typeof WORK_GRAPH_BACKEND_NODE_KIND;

/**
 * How a backend part names a deployment.
 *
 * Never a `Backend.id`: that is a UUID this browser generated and keeps in
 * localStorage, so it differs between two browsers pointed at the same
 * deployment and means nothing on another machine — and these keys travel, in
 * committed project-map annotations.
 */
export const WORK_GRAPH_BACKEND_KEY_SCHEMES = ["local", "cloud"] as const;

export type WorkGraphBackendKeyScheme =
  (typeof WORK_GRAPH_BACKEND_KEY_SCHEMES)[number];
