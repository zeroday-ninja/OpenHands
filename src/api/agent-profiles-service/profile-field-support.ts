import { getActiveBackend } from "#/api/backend-registry/active-store";
import { getCachedAgentServerInfo } from "#/api/agent-server-compatibility";

/** Local only: cloud launches do not enforce a profile's secret scope yet. */
export function agentProfileSupportsSecretRefs(): boolean {
  return getActiveBackend().backend.kind !== "cloud";
}

/** Only offer profile instructions where launches apply them. */
export function agentProfileSupportsInstructions(): boolean {
  return getActiveBackend().backend.kind !== "cloud";
}

/** Local only: cloud launches ignore a profile's tools for now. */
export function agentProfileSupportsTools(): boolean {
  return getActiveBackend().backend.kind !== "cloud";
}

/** Local only: cloud loads skills from its own catalog. */
export function agentProfileSupportsSkills(): boolean {
  return getActiveBackend().backend.kind !== "cloud";
}

/** Local only: cloud backends keep routers in the organization's store. */
export function agentProfileSupportsRouter(): boolean {
  return getActiveBackend().backend.kind !== "cloud";
}

/**
 * Local only, and only on an agent-server whose ACP profiles accept
 * `acp_fallback_server` / `acp_fallback_model` (the profile model rejects
 * unknown fields). The compatibility probe caches `/server_info` on connect,
 * so this reads the advertised capability synchronously.
 */
export const ACP_RUNTIME_FAILOVER_CAPABILITY = "acp_runtime_failover_v1";

export function agentProfileSupportsAcpFallback(): boolean {
  if (getActiveBackend().backend.kind === "cloud") return false;
  return (
    getCachedAgentServerInfo()?.capabilities?.includes(
      ACP_RUNTIME_FAILOVER_CAPABILITY,
    ) ?? false
  );
}
