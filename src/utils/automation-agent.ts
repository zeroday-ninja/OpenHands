import type {
  ACPAgentProfile,
  AgentProfileSummary,
} from "@openhands/typescript-client";
import {
  getAcpProviderDisplayName,
  resolveEffectiveAcpModel,
} from "#/constants/acp-providers";
import { I18nKey } from "#/i18n/declaration";
import type { Automation } from "#/types/automation";

/**
 * What an automation runs as, resolved for display.
 *
 * An automation pins either an LLM profile by name (`model`) or an agent
 * profile by id (`agent_profile_id`); with neither it runs as whatever profile
 * is active when it triggers. Only the id needs resolving, and only the id
 * carries the interesting answer — an automation on an agent profile has no
 * `model` at all, so showing the raw field says nothing about whether the run
 * is Claude Code, Codex or a local model.
 */
export type AutomationAgentDisplay =
  /** Runs as whichever profile is active at trigger time. */
  | { kind: "none" }
  /** Pins an LLM profile by name; the default OpenHands agent runs it. */
  | { kind: "model"; model: string }
  /** Pins an agent profile whose id has not been resolved yet. */
  | { kind: "pending" }
  /**
   * Pins an agent profile. `runtime` is the harness it runs — the ACP
   * provider (with its model) or the LLM profile an OpenHands profile
   * references — and is `null` when the surface did not pay for it.
   */
  | { kind: "profile"; name: string; runtime: string | null }
  /** Pins an agent profile that the backend does not (or no longer) lists. */
  | { kind: "missing"; profileId: string };

/** The ACP harness a profile runs, as a brand label plus its pinned model. */
function acpRuntimeLabel(profile: ACPAgentProfile): string {
  // An unbranded harness (`custom`, or one this Canvas does not know) has no
  // display name, so the stored key is the most honest label left.
  const provider =
    getAcpProviderDisplayName(profile.acp_server) ?? profile.acp_server;
  const model = resolveEffectiveAcpModel({ configured: profile.acp_model });
  return model ? `${provider} (${model})` : provider;
}

interface ResolveInput {
  automation: Pick<Automation, "agent_profile_id" | "model"> | undefined;
  /** The profile library, or `undefined` while loading or after a failure. */
  profiles: AgentProfileSummary[] | undefined;
  profilesLoading: boolean;
  /**
   * Full payload of the pinned profile when it is ACP, which is the only
   * place `acp_server` appears — the list endpoint omits it.
   */
  acpProfile?: ACPAgentProfile | null;
}

/**
 * Pure resolution shared by every surface that shows what an automation runs
 * as. A failed lookup resolves to `missing` rather than to nothing: the id is
 * all the user has to go on, and naming it beats an empty field or the
 * misleading "Active profile" placeholder.
 */
export function resolveAutomationAgentDisplay({
  automation,
  profiles,
  profilesLoading,
  acpProfile,
}: ResolveInput): AutomationAgentDisplay {
  const profileId = automation?.agent_profile_id?.trim() ?? "";
  if (!profileId) {
    const model = automation?.model?.trim();
    return model ? { kind: "model", model } : { kind: "none" };
  }

  if (!profiles) {
    return profilesLoading
      ? { kind: "pending" }
      : { kind: "missing", profileId };
  }

  const summary = profiles.find((profile) => profile.id === profileId);
  if (!summary) return { kind: "missing", profileId };

  let runtime: string | null = null;
  if (summary.agent_kind === "acp") {
    runtime = acpProfile ? acpRuntimeLabel(acpProfile) : null;
  } else {
    runtime = summary.llm_profile_ref?.trim() || null;
  }

  return { kind: "profile", name: summary.name, runtime };
}

/**
 * One line for a compact surface — a dashboard card's pill — or `null` when
 * there is nothing worth the space: an automation on the active profile says
 * nothing a card reader can act on, and an id still resolving would flicker.
 */
export function automationAgentPillLabel(
  agent: AutomationAgentDisplay,
  t: (key: I18nKey, values?: Record<string, string>) => string,
): string | null {
  switch (agent.kind) {
    case "model":
      return agent.model;
    case "profile":
      return agent.runtime ? `${agent.name} (${agent.runtime})` : agent.name;
    case "missing":
      return t(I18nKey.AUTOMATIONS$UNAVAILABLE_AGENT_PROFILE, {
        id: agent.profileId,
      });
    default:
      return null;
  }
}
