/**
 * Wire types for the agent-server's `/api/soul` resource.
 *
 * `SOUL.md` is a single user-level document, not a per-conversation resource,
 * so the server exposes it as one resource with `GET` and `PUT`. There is no
 * `DELETE`: a `PUT` with empty content reverts to the built-in default.
 */

/**
 * The server rejects longer content with a 422 (`SoulUpdateRequest`'s
 * `max_length`). Declared with the wire types rather than in the service so
 * the MSW handler can enforce the same bound without importing the service.
 */
export const MAX_SOUL_LENGTH = 65536;

export interface SoulResponse {
  /** The identity text the agent will use; the default when `exists` is false. */
  content: string;
  /** Whether the user has their own SOUL.md on disk. */
  exists: boolean;
  /** Absolute path SOUL.md resolves to on this server. */
  path: string;
  /** UTF-8 byte length of `content`. */
  size_bytes: number;
}

/** Why SOUL.md cannot be read or written on the active backend. */
export type SoulUnsupportedReason =
  /** No backend is configured at all. */
  | "no-backend"
  /** Cloud backends do not expose the route. */
  | "cloud-backend"
  /** The agent server is older than the route. */
  | "missing-api";
