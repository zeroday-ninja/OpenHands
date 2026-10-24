/**
 * The work graph's key grammar: `oh:1/<backendKey>/<kind token>:<id>`.
 *
 * Three properties make this grammar worth having at all:
 *
 *  - **It is global.** A deployment only knows keys relative to itself
 *    (`cycle:5f1c…`), and two deployments will happily hand out the same one
 *    for different work. The backend part disambiguates them.
 *  - **It is content-addressed where the thing is.** A repository, a cited
 *    source, or a pull request is the same object whichever deployment
 *    mentions it, so those keys carry no backend part at all
 *    (`oh:1//repo:<url>@<ref>`) and collapse to one node on sight.
 *  - **It is versioned.** These keys are written into committed project-map
 *    annotations and travel to other machines and later builds. A key from a
 *    grammar this build does not know must come back as *unresolved*, never be
 *    re-matched against whatever node happens to look similar today.
 *
 * The backend part is deliberately **not** a `Backend.id`: that is a UUID this
 * browser generated and stores in localStorage, so the same deployment has a
 * different id in another browser profile and no meaning at all on another
 * machine. It is derived from what actually identifies a deployment — its host
 * (and, for Cloud, the organization).
 */

import type { Backend } from "#/api/backend-registry/types";
import {
  CONTENT_ADDRESSED_ARTIFACT_ID_PREFIX,
  CONTENT_ADDRESSED_KEY_TOKENS,
  WORK_GRAPH_ARTIFACT_KEY_TOKEN,
  WORK_GRAPH_BACKEND_NODE_ID,
  WORK_GRAPH_BACKEND_NODE_KIND,
  WORK_GRAPH_KEY_NAMESPACE,
  WORK_GRAPH_KEY_PREFIX,
  WORK_GRAPH_KEY_SEPARATOR,
  WORK_GRAPH_KEY_TOKEN_SEPARATOR,
  WORK_GRAPH_KEY_VERSION,
  type WorkGraphBackendKeyScheme,
} from "#/types/work-graph";

/**
 * How many `/`-separated segments each backend scheme occupies.
 *
 * Fixed arity per scheme is what makes the grammar parseable at all: a node id
 * is routinely a URL and a Cloud backend key contains an organization, so both
 * sides of the backend part can hold a `/`. The scheme token says how many to
 * consume from the left; everything after them is the node part, verbatim.
 */
const BACKEND_KEY_SEGMENT_COUNTS: Record<WorkGraphBackendKeyScheme, number> = {
  local: 1,
  cloud: 2,
};

/** Ports that say nothing about which deployment is meant. */
const DEFAULT_PORT_BY_SCHEME: Record<string, string> = {
  http: "80",
  https: "443",
};

/** Why a key could not be resolved to parts. */
export const WORK_GRAPH_KEY_UNRESOLVED_REASONS = [
  /** The grammar version is not the one this build writes. */
  "unsupported-version",
  /** The string is not a work-graph key of any version. */
  "malformed",
] as const;

export type WorkGraphKeyUnresolvedReason =
  (typeof WORK_GRAPH_KEY_UNRESOLVED_REASONS)[number];

export interface WorkGraphKeyParts {
  /** `null` for a content-addressed key, which belongs to no deployment. */
  backendKey: string | null;
  /**
   * The key's kind token. The service's abbreviation of the node's `kind`
   * (`repo` for a `repository`), so it is not validated against the kind list:
   * a kind added later must not make today's annotations unresolvable.
   */
  kindToken: string;
  id: string;
}

export type ParsedWorkGraphKey =
  | ({
      status: "resolved";
      key: string;
      version: typeof WORK_GRAPH_KEY_VERSION;
      isContentAddressed: boolean;
    } & WorkGraphKeyParts)
  | {
      status: "unresolved";
      key: string;
      reason: WorkGraphKeyUnresolvedReason;
      /** The version found in the string, when it had a readable one. */
      version: number | null;
    };

/**
 * Make one component of a backend key safe to put in a key.
 *
 * Only `/` and `%` can confuse the grammar, so only those are escaped:
 * `encodeURIComponent` would turn a readable `local:localhost:8000` into
 * noise. The escaped form *is* the canonical backend key — nothing decodes it
 * again, so building and parsing a key always round-trips exactly.
 */
function encodeBackendKeyComponent(value: string): string {
  return value.replace(/%/g, "%25").replace(/\//g, "%2F");
}

/**
 * Reduce a backend host to what identifies the deployment behind it.
 *
 * The scheme is dropped: `http://host:8000` and `https://host:8000` are one
 * deployment reached two ways, and keeping the scheme would also put a `//`
 * inside the backend part. The authority is lowercased because DNS is
 * case-insensitive; any path prefix is kept as written because paths are not.
 */
function normalizeBackendHost(host: string): string {
  const trimmed = host.trim();
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(trimmed);
  const scheme = schemeMatch ? schemeMatch[1].toLowerCase() : null;
  const withoutScheme = schemeMatch
    ? trimmed.slice(schemeMatch[0].length)
    : trimmed;
  const withoutTrailingSlash = withoutScheme.replace(/\/+$/, "");

  const pathStart = withoutTrailingSlash.indexOf("/");
  const authority = (
    pathStart === -1
      ? withoutTrailingSlash
      : withoutTrailingSlash.slice(0, pathStart)
  ).toLowerCase();
  const path = pathStart === -1 ? "" : withoutTrailingSlash.slice(pathStart);

  const defaultPort = scheme ? DEFAULT_PORT_BY_SCHEME[scheme] : undefined;
  const authorityWithoutDefaultPort =
    defaultPort && authority.endsWith(`:${defaultPort}`)
      ? authority.slice(0, -(defaultPort.length + 1))
      : authority;

  return `${authorityWithoutDefaultPort}${path}`;
}

/**
 * How this deployment is named inside a key.
 *
 * A Cloud backend always emits its organization segment, empty when no
 * organization is selected, so the segment count stays fixed per scheme.
 *
 * An empty host yields an empty authority. That only happens for the
 * `NO_BACKEND` sentinel, which callers are expected to skip before they get
 * here.
 */
export function workGraphBackendKey(
  backend: Backend,
  orgId: string | null | undefined,
): string {
  const host = encodeBackendKeyComponent(normalizeBackendHost(backend.host));
  if (backend.kind === "cloud") {
    const org = encodeBackendKeyComponent(orgId ?? "");
    return `cloud${WORK_GRAPH_KEY_TOKEN_SEPARATOR}${host}${WORK_GRAPH_KEY_SEPARATOR}${org}`;
  }
  return `local${WORK_GRAPH_KEY_TOKEN_SEPARATOR}${host}`;
}

/** The part of a key that names the node, with no deployment attached. */
export type WorkGraphNodeKeyParts = Pick<WorkGraphKeyParts, "kindToken" | "id">;

/** Split a deployment-relative key (`<kind token>:<id>`) at its first colon. */
export function parseBackendRelativeKey(
  key: string,
): WorkGraphNodeKeyParts | null {
  const separator = key.indexOf(WORK_GRAPH_KEY_TOKEN_SEPARATOR);
  if (separator <= 0) return null;
  const kindToken = key.slice(0, separator);
  const id = key.slice(separator + 1);
  if (!id) return null;
  return { kindToken, id };
}

/**
 * Whether this key names the same thing in every deployment.
 *
 * Decided from the key alone — never from a node's `kind` — because an edge
 * endpoint is only ever a key. A rule that needed the node payload would
 * address a repository one way when a node for it arrived and another way when
 * only an edge mentioned it, and the edge would dangle.
 */
export function isContentAddressedWorkGraphKey(
  parts: WorkGraphNodeKeyParts,
): boolean {
  const token = parts.kindToken.toLowerCase();
  if ((CONTENT_ADDRESSED_KEY_TOKENS as readonly string[]).includes(token)) {
    return true;
  }
  return (
    token === WORK_GRAPH_ARTIFACT_KEY_TOKEN &&
    parts.id.startsWith(CONTENT_ADDRESSED_ARTIFACT_ID_PREFIX)
  );
}

/** Assemble a global key. `backendKey` must come from `workGraphBackendKey`. */
export function buildWorkGraphKey(parts: WorkGraphKeyParts): string {
  const backendPart = parts.backendKey ?? "";
  return [
    WORK_GRAPH_KEY_PREFIX,
    backendPart,
    `${parts.kindToken}${WORK_GRAPH_KEY_TOKEN_SEPARATOR}${parts.id}`,
  ].join(WORK_GRAPH_KEY_SEPARATOR);
}

/**
 * Lift a deployment-relative key into a global one, dropping the backend part
 * for content-addressed keys. `null` when the key is not a
 * `<kind token>:<id>` pair at all, so the caller can report it instead of
 * inventing a node.
 */
export function globalizeWorkGraphKey(
  backendKey: string,
  backendRelativeKey: string,
): string | null {
  const parts = parseBackendRelativeKey(backendRelativeKey);
  if (!parts) return null;
  return buildWorkGraphKey({
    ...parts,
    backendKey: isContentAddressedWorkGraphKey(parts) ? null : backendKey,
  });
}

/** The key of the node that stands for a deployment itself. */
export function workGraphBackendNodeKey(backendKey: string): string {
  return buildWorkGraphKey({
    backendKey,
    kindToken: WORK_GRAPH_BACKEND_NODE_KIND,
    id: WORK_GRAPH_BACKEND_NODE_ID,
  });
}

function unresolved(
  key: string,
  reason: WorkGraphKeyUnresolvedReason,
  version: number | null,
): ParsedWorkGraphKey {
  return { status: "unresolved", key, reason, version };
}

/**
 * Read a global key back into its parts.
 *
 * A key whose grammar version is not this build's resolves to
 * `unsupported-version` with no parts: the segments may mean something else in
 * that grammar, and guessing would silently re-point an annotation at the
 * wrong work.
 */
export function parseWorkGraphKey(key: string): ParsedWorkGraphKey {
  const versionMatch = new RegExp(
    `^${WORK_GRAPH_KEY_NAMESPACE}${WORK_GRAPH_KEY_TOKEN_SEPARATOR}(\\d+)${WORK_GRAPH_KEY_SEPARATOR}`,
  ).exec(key);
  if (!versionMatch) return unresolved(key, "malformed", null);

  const version = Number(versionMatch[1]);
  if (version !== WORK_GRAPH_KEY_VERSION) {
    return unresolved(key, "unsupported-version", version);
  }

  const rest = key.slice(versionMatch[0].length);

  // An empty backend part — the key opens with the separator — is what makes a
  // key content-addressed. Structure decides it here, so a key parses without
  // consulting the token list that built it.
  if (rest.startsWith(WORK_GRAPH_KEY_SEPARATOR)) {
    const node = parseBackendRelativeKey(rest.slice(1));
    if (!node) return unresolved(key, "malformed", version);
    return {
      status: "resolved",
      key,
      version: WORK_GRAPH_KEY_VERSION,
      backendKey: null,
      kindToken: node.kindToken,
      id: node.id,
      isContentAddressed: true,
    };
  }

  const schemeSeparator = rest.indexOf(WORK_GRAPH_KEY_TOKEN_SEPARATOR);
  if (schemeSeparator <= 0) return unresolved(key, "malformed", version);
  const scheme = rest.slice(0, schemeSeparator);
  if (!Object.hasOwn(BACKEND_KEY_SEGMENT_COUNTS, scheme)) {
    return unresolved(key, "malformed", version);
  }
  const segmentCount =
    BACKEND_KEY_SEGMENT_COUNTS[scheme as WorkGraphBackendKeyScheme];

  let cursor = -1;
  for (let consumed = 0; consumed < segmentCount; consumed += 1) {
    cursor = rest.indexOf(WORK_GRAPH_KEY_SEPARATOR, cursor + 1);
    if (cursor === -1) return unresolved(key, "malformed", version);
  }

  const node = parseBackendRelativeKey(rest.slice(cursor + 1));
  if (!node) return unresolved(key, "malformed", version);

  return {
    status: "resolved",
    key,
    version: WORK_GRAPH_KEY_VERSION,
    backendKey: rest.slice(0, cursor),
    kindToken: node.kindToken,
    id: node.id,
    isContentAddressed: false,
  };
}
