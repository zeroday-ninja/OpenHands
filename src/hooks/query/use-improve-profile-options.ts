import { useQueries } from "@tanstack/react-query";
import AgentProfilesService from "#/api/agent-profiles-service/agent-profiles-service.api";
import { useActiveBackend } from "#/contexts/active-backend-context";
import { useAgentProfiles } from "#/hooks/query/use-agent-profiles";
import { resolveAutomationAgentDisplay } from "#/utils/automation-agent";
import {
  AGENT_PROFILES_QUERY_KEYS,
  AGENT_PROFILES_RETRY_OPTIONS,
  CONFIG_CACHE_OPTIONS,
} from "./query-keys";

/** One agent profile a program can build or review with. */
export interface ImproveProfileOption {
  id: string;
  name: string;
  /**
   * The harness it runs — the ACP provider with its model, or the LLM profile
   * an OpenHands profile references — or `null` when that is not known yet.
   * Which runtime a profile is, is the whole question here: reviews are only
   * independent when they come from a different one than the builder.
   */
  runtime: string | null;
}

/**
 * The profile library as the improvement-program form offers it: every
 * profile, named with the runtime it actually runs.
 *
 * `GET /api/agent-profiles` summarises a profile without `acp_server`, so an
 * ACP profile's runtime comes from its detail. Those details are fetched on
 * the shared `AGENT_PROFILES_QUERY_KEYS.detail` key, so a page that already
 * showed one (the automation detail page's "runs as" line) pays nothing for
 * it again. Resolution itself is `resolveAutomationAgentDisplay`, the same
 * function every other surface answers this question with.
 */
export function useImproveProfileOptions({
  enabled = true,
}: { enabled?: boolean } = {}): {
  options: ImproveProfileOption[];
  isLoading: boolean;
  isError: boolean;
} {
  const { backend, orgId } = useActiveBackend();
  const { data, isLoading, isError } = useAgentProfiles({ enabled });
  const profiles = data?.profiles ?? [];
  const acpNames = profiles
    .filter((profile) => profile.agent_kind === "acp")
    .map((profile) => profile.name);

  const details = useQueries({
    queries: acpNames.map((name) => ({
      queryKey: AGENT_PROFILES_QUERY_KEYS.detail(backend.id, orgId, name),
      queryFn: () => AgentProfilesService.getProfile(name),
      ...CONFIG_CACHE_OPTIONS,
      ...AGENT_PROFILES_RETRY_OPTIONS,
      meta: { disableToast: true },
    })),
  });

  const options = profiles.flatMap((summary) => {
    if (!summary.id) return [];
    const detail = details[acpNames.indexOf(summary.name)]?.data?.profile;
    const display = resolveAutomationAgentDisplay({
      automation: { agent_profile_id: summary.id, model: null },
      profiles,
      profilesLoading: isLoading,
      acpProfile: detail?.agent_kind === "acp" ? detail : null,
    });
    if (display.kind !== "profile") return [];
    return [{ id: summary.id, name: display.name, runtime: display.runtime }];
  });

  return { options, isLoading, isError };
}
