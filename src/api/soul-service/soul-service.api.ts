/**
 * Reads and writes the user's `SOUL.md` through the agent server's
 * `/api/soul` resource (software-agent-sdk `soul_router.py`).
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
import type { SoulResponse, SoulUnsupportedReason } from "./soul.types";

const SOUL_PATH = "/api/soul";

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

function getClient(): AgentServerClient {
  const reason = soulUnsupportedReasonFor(getActiveBackend().backend);
  if (reason) throw new SoulUnsupportedError(reason);
  const { host, apiKey } = getAgentServerClientOptions();
  return new AgentServerClient({ host, ...(apiKey ? { apiKey } : {}) });
}

async function withClient<T>(
  operation: (client: AgentServerClient) => Promise<T>,
): Promise<T> {
  const client = getClient();
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
}

export default SoulService;
