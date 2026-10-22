import { useQueries } from "@tanstack/react-query";
import AgentProfilesService, {
  type AgentProfileSummary,
  type StoredAcpProfile,
} from "#/api/agent-profiles-service/agent-profiles-service.api";
import { useActiveBackend } from "#/contexts/active-backend-context";
import { useAgentProfiles } from "#/hooks/query/use-agent-profiles";
import {
  AGENT_PROFILES_QUERY_KEYS,
  AGENT_PROFILES_RETRY_OPTIONS,
  CONFIG_CACHE_OPTIONS,
} from "./query-keys";

/** One agent-runtime (ACP) profile, with its stored fields once they load. */
export interface AgentRuntimeProfileEntry {
  summary: AgentProfileSummary;
  /**
   * The full profile, or null while its detail loads or if that read failed.
   * `GET /api/agent-profiles` summarises a profile without `acp_server` /
   * `acp_model`, so the runtime and model a row shows come from the detail.
   */
  detail: StoredAcpProfile | null;
}

/**
 * The user's agent-runtime profiles: the `agent_kind: "acp"` agent profiles,
 * each paired with its stored runtime and model.
 *
 * These are the same records Settings → Agents manages — there is one store,
 * `/api/agent-profiles`, and this is a second view of it. Details are fetched
 * on the shared `AGENT_PROFILES_QUERY_KEYS.detail` key, so a save from either
 * view refreshes both.
 */
export function useAgentRuntimeProfiles(): {
  entries: AgentRuntimeProfileEntry[];
  isLoading: boolean;
  error: Error | null;
} {
  const { backend, orgId } = useActiveBackend();
  const { data, isLoading, error } = useAgentProfiles();
  const summaries = (data?.profiles ?? []).filter(
    (profile) => profile.agent_kind === "acp",
  );

  const details = useQueries({
    queries: summaries.map((summary) => ({
      queryKey: AGENT_PROFILES_QUERY_KEYS.detail(
        backend.id,
        orgId,
        summary.name,
      ),
      queryFn: () => AgentProfilesService.getProfile(summary.name),
      ...CONFIG_CACHE_OPTIONS,
      ...AGENT_PROFILES_RETRY_OPTIONS,
      meta: { disableToast: true },
    })),
  });

  return {
    entries: summaries.map((summary, index) => {
      const profile = details[index]?.data?.profile;
      return {
        summary,
        detail: profile?.agent_kind === "acp" ? profile : null,
      };
    }),
    isLoading,
    error: error ?? null,
  };
}
