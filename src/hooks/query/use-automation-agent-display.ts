import { useQuery } from "@tanstack/react-query";
import AgentProfilesService from "#/api/agent-profiles-service/agent-profiles-service.api";
import { useActiveBackend } from "#/contexts/active-backend-context";
import type { Automation } from "#/types/automation";
import {
  resolveAutomationAgentDisplay,
  type AutomationAgentDisplay,
} from "#/utils/automation-agent";
import { useAgentProfiles } from "./use-agent-profiles";
import {
  AGENT_PROFILES_QUERY_KEYS,
  AGENT_PROFILES_RETRY_OPTIONS,
  CONFIG_CACHE_OPTIONS,
} from "./query-keys";

interface UseAutomationAgentDisplayOptions {
  /**
   * Also resolve an ACP profile's harness, which costs one profile-detail
   * request per distinct profile — `acp_server` is absent from the list
   * payload. A page about a single automation pays it; a list of automations
   * does not, and shows the profile's name alone.
   */
  withRuntime?: boolean;
}

/**
 * What one automation runs as: the agent profile it pins, resolved to that
 * profile's name and runtime, or the LLM profile it pins by name.
 *
 * The profile library is one shared query, so any number of cards on a page
 * resolve their profiles from a single request. Works on local and cloud
 * backends alike (`AgentProfilesService` routes cloud through the proxy); a
 * backend that cannot answer leaves the automation's profile id named rather
 * than hidden.
 */
export function useAutomationAgentDisplay(
  automation: Pick<Automation, "agent_profile_id" | "model"> | undefined,
  { withRuntime = false }: UseAutomationAgentDisplayOptions = {},
): AutomationAgentDisplay {
  const { backend, orgId } = useActiveBackend();
  const profileId = automation?.agent_profile_id?.trim() ?? "";
  const { data, isLoading } = useAgentProfiles({ enabled: profileId !== "" });
  const profiles = data?.profiles;
  const summary = profiles?.find((profile) => profile.id === profileId);
  // Only an ACP profile hides its harness behind the detail endpoint.
  const acpProfileName =
    withRuntime && summary?.agent_kind === "acp" ? summary.name : "";

  const { data: detail } = useQuery({
    queryKey: AGENT_PROFILES_QUERY_KEYS.detail(
      backend.id,
      orgId,
      acpProfileName,
    ),
    queryFn: () => AgentProfilesService.getProfile(acpProfileName),
    enabled: acpProfileName !== "",
    ...CONFIG_CACHE_OPTIONS,
    ...AGENT_PROFILES_RETRY_OPTIONS,
    meta: { disableToast: true },
  });
  const acpProfile =
    detail?.profile.agent_kind === "acp" ? detail.profile : null;

  return resolveAutomationAgentDisplay({
    automation,
    profiles,
    profilesLoading: isLoading,
    acpProfile,
  });
}
