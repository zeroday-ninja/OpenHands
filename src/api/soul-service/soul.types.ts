/**
 * Wire types for the agent-server's `/api/soul` resource.
 *
 * `SOUL.md` is a single user-level document, not a per-conversation resource,
 * so the server exposes it as one resource with `GET` and `PUT`. There is no
 * `DELETE`: a `PUT` with empty content reverts to the built-in default.
 *
 * `/api/soul/documents` is the same idea for the whole identity set: SOUL.md
 * answers "who is this person" and was never going to answer "how do they
 * write" or "what have we already learned", so the server declares a small
 * closed set of documents (software-agent-sdk `context/identity.py`) and
 * serves each one by its stable name.
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

/**
 * Largest a single identity document may be, in characters. The server
 * rejects more with a 422 (`IdentityDocumentUpdateRequest`'s `max_length`).
 *
 * Declared separately from {@link MAX_SOUL_LENGTH} even though both are
 * currently 65536: the server bounds the single-file route and each document
 * of the set independently, and tying them together here would make a change
 * to either silently move the other.
 */
export const MAX_IDENTITY_DOCUMENT_LENGTH = 65536;

/** One document in the identity set, written or not. */
export interface IdentityDocumentResponse {
  /** Stable id used in the route, e.g. `style`. */
  name: string;
  /** Where the document sits under the identity directory, e.g. `STYLE.md`. */
  relative_path: string;
  /**
   * What belongs in this document, in the server's words. Shown to the user
   * and never sent to a model; the server owns the text, so Canvas renders it
   * rather than translating it.
   */
  purpose: string;
  /** What is written, or empty when nothing has been. */
  content: string;
  /**
   * Whether anything has been written. Blank content deletes a document, so
   * "never written" and "written, then emptied" are the same state.
   */
  exists: boolean;
  /** Absolute path the document resolves to on this server. */
  path: string;
  /** UTF-8 byte length of `content`. */
  size_bytes: number;
}

/**
 * Every document the agent server knows about, in the order a prompt reads
 * them: identity, then voice, then recent memory, then examples, then raw
 * data. The order is the server's, so Canvas renders the list as it arrives
 * rather than sorting it again.
 */
export interface IdentitySetResponse {
  documents: IdentityDocumentResponse[];
  /** Absolute path of the directory the set lives in. */
  directory: string;
}

/**
 * Why the user's identity — SOUL.md or the document set — cannot be read or
 * written on the active backend.
 */
export type SoulUnsupportedReason =
  /** No backend is configured at all. */
  | "no-backend"
  /** Cloud backends do not expose the route. */
  | "cloud-backend"
  /** The agent server is older than the route. */
  | "missing-api";
