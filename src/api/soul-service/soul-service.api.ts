/**
 * Reads and writes the user's identity through the agent server's `/api/soul`
 * resource (software-agent-sdk `soul_router.py`): `SOUL.md` on its own, and
 * the document set under `/api/soul/documents`.
 *
 * The pinned `@openhands/typescript-client` has no `SoulClient`: the route is
 * newer than the client release. Transport therefore goes through
 * `AgentServerClient`'s generic verb helpers, which is how this repo already
 * reaches agent-server routes without a generated client
 * (`provider-connections-service`, `canvas-extensions-service`). Host and
 * session API key still come from `getAgentServerClientOptions()`, so no raw
 * `fetch`/`axios` is involved and the direct-call guard needs no new entry.
 *
 * The route is also not in any released agent server, so it stays optional:
 * a 404 becomes `SoulUnsupportedError("missing-api")` and the page renders an
 * unsupported state instead of an error. That is why
 * `compatibility.minimumAgentServer` is deliberately not raised for it.
 */
import { AgentServerClient } from "@openhands/typescript-client/clients";
import { getAgentServerClientOptions } from "#/api/agent-server-client-options";
import { isSdkHttpStatusError } from "#/api/agent-server-compatibility";
import {
  getActiveBackend,
  isNoBackend,
} from "#/api/backend-registry/active-store";
import type { Backend } from "#/api/backend-registry/types";
import type {
  IdentityDocumentResponse,
  IdentitySetResponse,
  MemoryMergeResponse,
  SoulResponse,
  SoulUnsupportedReason,
} from "./soul.types";

const SOUL_PATH = "/api/soul";
const IDENTITY_DOCUMENTS_PATH = `${SOUL_PATH}/documents`;

/** Where several backends' memory is folded into one. */
const MEMORY_MERGE_PATH = `${IDENTITY_DOCUMENTS_PATH}/memory/merge`;

/** The document that is a log rather than a text someone edits. */
export const MEMORY_DOCUMENT_NAME = "memory";

/**
 * A document's own route. The name is a stable id the server declared in the
 * set (`soul`, `style`, …), not user input, so it needs no escaping — but it
 * is encoded anyway so a name the server adds later cannot build a path that
 * reaches somewhere else.
 */
function identityDocumentPath(name: string): string {
  return `${IDENTITY_DOCUMENTS_PATH}/${encodeURIComponent(name)}`;
}

export class SoulUnsupportedError extends Error {
  readonly reason: SoulUnsupportedReason;

  constructor(reason: SoulUnsupportedReason) {
    super(`SOUL.md is unavailable on this backend: ${reason}`);
    this.name = "SoulUnsupportedError";
    this.reason = reason;
  }
}

/**
 * Recognized across a serialization boundary (React Query caches the error
 * object, and a rebuilt instance loses `instanceof`), the way
 * `isCanvasExtensionsUnsupportedError` is.
 */
export function isSoulUnsupportedError(
  error: unknown,
): error is SoulUnsupportedError {
  return (
    error instanceof SoulUnsupportedError ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      error.name === "SoulUnsupportedError")
  );
}

/**
 * Why a backend cannot serve SOUL.md, or null when it can. Pure so the page
 * can decide from the backend it is rendering without waiting for a request.
 */
export function soulUnsupportedReasonFor(
  backend: Backend,
): SoulUnsupportedReason | null {
  if (isNoBackend(backend)) return "no-backend";
  // Cloud has no per-user SOUL.md store: the route lives on an agent server.
  if (backend.kind === "cloud") return "cloud-backend";
  return null;
}

/**
 * The backends a memory sync could include.
 *
 * Here rather than beside the sync, because it is a question about a backend
 * and not about a mutation — and because three callers ask it: the button
 * hides itself when fewer than two are eligible, the sync skips the rest with
 * a reason, and filing a correction only spreads it when there is somewhere
 * to spread it to. A fourth answer would be a fourth definition.
 */
export function eligibleForSync(backends: readonly Backend[]): Backend[] {
  return backends.filter(
    (candidate) => soulUnsupportedReasonFor(candidate) === null,
  );
}

function getClient(backend?: Backend): AgentServerClient {
  const target = backend ?? getActiveBackend().backend;
  const reason = soulUnsupportedReasonFor(target);
  if (reason) throw new SoulUnsupportedError(reason);
  // Syncing reaches backends other than the active one, so the options are
  // pinned to the backend being asked rather than read from the module-level
  // active selection — otherwise every request in a fan-out would go to
  // whichever backend happened to be selected.
  const { host, apiKey } = backend
    ? { host: backend.host, apiKey: backend.apiKey }
    : getAgentServerClientOptions();
  return new AgentServerClient({ host, ...(apiKey ? { apiKey } : {}) });
}

async function withClient<T>(
  operation: (client: AgentServerClient) => Promise<T>,
  backend?: Backend,
): Promise<T> {
  const client = getClient(backend);
  try {
    return await operation(client);
  } catch (error) {
    if (isSdkHttpStatusError(error, 404)) {
      throw new SoulUnsupportedError("missing-api");
    }
    throw error;
  } finally {
    client.close();
  }
}

class SoulService {
  /** The identity text in effect, and whether the user owns it. */
  static getSoul(): Promise<SoulResponse> {
    return withClient((client) => client.get<SoulResponse>(SOUL_PATH));
  }

  /**
   * Replace SOUL.md and return what is now in effect. Empty or
   * whitespace-only content deletes the file and reverts to the built-in
   * default, which is how the page's "revert" action is expressed.
   */
  static saveSoul(content: string): Promise<SoulResponse> {
    return withClient((client) =>
      client.put<SoulResponse>(SOUL_PATH, { content }),
    );
  }

  /**
   * Every identity document the agent server declares, in the order a prompt
   * reads them. Documents nobody has written are included, with empty
   * `content` and `exists: false`, because the point of the page is to show
   * what could be written as much as what has been.
   */
  static getIdentityDocuments(): Promise<IdentitySetResponse> {
    return withClient((client) =>
      client.get<IdentitySetResponse>(IDENTITY_DOCUMENTS_PATH),
    );
  }

  /**
   * Replace one document and return it as it now stands. Empty or
   * whitespace-only content deletes it instead of writing an empty file, so
   * clearing a document is the same state as never having written one — which
   * is how the page's "clear" action is expressed.
   *
   * A 404 here means the same thing it means for the set: this agent server
   * does not serve identity documents. It would also be the answer for a name
   * the server does not declare, but Canvas only ever writes names the server
   * itself just listed.
   */
  /**
   * One identity document from the active backend.
   *
   * The symmetric read for `saveIdentityDocument`: a writer that has to append
   * to a document needs what is in it, and the set listing carries sizes
   * rather than content.
   */
  static getIdentityDocument(name: string): Promise<IdentityDocumentResponse> {
    return withClient((client) =>
      client.get<IdentityDocumentResponse>(identityDocumentPath(name)),
    );
  }

  /**
   * One identity document from a named backend.
   *
   * Takes the backend explicitly because syncing reads from backends other
   * than the active one, which the rest of this service has no reason to do.
   */
  static getIdentityDocumentFrom(
    backend: Backend,
    name: string,
  ): Promise<IdentityDocumentResponse> {
    return withClient(
      (client) =>
        client.get<IdentityDocumentResponse>(identityDocumentPath(name)),
      backend,
    );
  }

  /**
   * Fold other backends' memory into one backend's, losing nothing.
   *
   * The server does the merging. Memory is append-only, so the merge is a
   * union by entry id: it converges whichever order the backends are reached
   * in, running it twice changes nothing, and an entry can only ever appear
   * or stay.
   */
  static mergeMemory(logs: string[]): Promise<MemoryMergeResponse> {
    return withClient((client) =>
      client.post<MemoryMergeResponse>(MEMORY_MERGE_PATH, { logs }),
    );
  }

  /**
   * The same, into a named backend.
   *
   * Takes the backend explicitly for the reason the reads here do: syncing
   * writes to backends other than the active one, which nothing else needs.
   */
  static mergeMemoryInto(
    backend: Backend,
    logs: string[],
  ): Promise<MemoryMergeResponse> {
    return withClient(
      (client) => client.post<MemoryMergeResponse>(MEMORY_MERGE_PATH, { logs }),
      backend,
    );
  }

  static saveIdentityDocument(
    name: string,
    content: string,
  ): Promise<IdentityDocumentResponse> {
    return withClient((client) =>
      client.put<IdentityDocumentResponse>(identityDocumentPath(name), {
        content,
      }),
    );
  }
}

export default SoulService;
