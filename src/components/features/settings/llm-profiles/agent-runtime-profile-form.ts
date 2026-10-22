import type { ACPServerKind } from "@openhands/typescript-client";
import type {
  AgentProfileSaveInput,
  StoredAcpProfile,
} from "#/api/agent-profiles-service/agent-profiles-service.api";
import { ACP_CUSTOM_PRESET_KEY } from "#/constants/acp-providers";
import {
  composeAcpModelEffort,
  splitAcpModelEffort,
} from "#/utils/acp-model-effort";
import { deriveProfileNameFromModel } from "#/utils/derive-profile-name";

/**
 * What the LLM tab's runtime-profile editor holds: which agent runtime to
 * launch and the model it should run. The reasoning effort is kept apart from
 * the model id here so the user picks the two separately and never types the
 * combined ``<model>/<effort>`` id the agent-server stores.
 *
 * This is the *whole* contract of the LLM-tab editor. Everything else an ACP
 * profile carries — launch command, session mode, timeouts, MCP/secret scope,
 * usage-limit failover — stays owned by Settings → Agents and is preserved on
 * save, never modelled here.
 */
export interface RuntimeProfileDraft {
  /** Built-in ACP runtime key, or ``custom`` for a profile Agents owns. */
  server: ACPServerKind;
  /** Base model id with no effort suffix. Empty = let the runtime choose. */
  modelId: string;
  /** Effort level, or null for the runtime's own default. */
  effort: string | null;
}

/**
 * The draft the editor opens with. ``null`` starts a new profile on
 * ``fallbackServer``.
 */
export function runtimeProfileDraft(
  stored: StoredAcpProfile | null,
  fallbackServer: ACPServerKind,
): RuntimeProfileDraft {
  if (!stored) return { server: fallbackServer, modelId: "", effort: null };
  // A custom-command profile's model is whatever its own wrapper accepts, so
  // it is never split: a slash there is part of the id, not an effort.
  if (stored.acp_server === ACP_CUSTOM_PRESET_KEY) {
    return {
      server: stored.acp_server,
      modelId: stored.acp_model ?? "",
      effort: null,
    };
  }
  const { modelId, effort } = splitAcpModelEffort(stored.acp_model);
  return { server: stored.acp_server, modelId: modelId ?? "", effort };
}

/** The ``acp_model`` a draft saves: one combined id, or null for the default. */
export function runtimeProfileAcpModel(
  draft: RuntimeProfileDraft,
): string | null {
  const modelId = draft.modelId.trim();
  if (!modelId) return null;
  return draft.server === ACP_CUSTOM_PRESET_KEY
    ? modelId
    : composeAcpModelEffort(modelId, draft.effort);
}

/**
 * The fields this editor owns, shaped for ``POST /api/agent-profiles/{name}``.
 * That endpoint is a whole-profile overwrite, so the result must go through
 * ``mergeAgentProfileSaveInput(stored, …)`` to keep every field the editor
 * does not model.
 */
export function buildRuntimeProfileEdits(
  stored: StoredAcpProfile | null,
  draft: RuntimeProfileDraft,
): AgentProfileSaveInput {
  const edits: Record<string, unknown> = {
    agent_kind: "acp",
    acp_server: draft.server,
    acp_model: runtimeProfileAcpModel(draft),
  };
  if (stored && stored.acp_server !== draft.server) {
    // An explicit command belongs to the runtime it was written for; left in
    // place it would spawn the old runtime under the new one's name. Null
    // means "use the default command for acp_server".
    edits.acp_command = null;
    edits.acp_args = null;
    // Failing over to the runtime now running is not a failover. Only emitted
    // when the stored profile actually carries the field, so an agent-server
    // without `acp_runtime_failover_v1` — whose profile model forbids unknown
    // fields — never receives it.
    if (stored.acp_fallback_server === draft.server) {
      edits.acp_fallback_server = null;
      edits.acp_fallback_model = null;
    }
  }
  return edits as AgentProfileSaveInput;
}

/** A name for a new runtime profile, e.g. ``codex-gpt-5.5-codex``. */
export function deriveRuntimeProfileName(draft: RuntimeProfileDraft): string {
  const modelId = draft.modelId.trim();
  if (!modelId) return draft.server;
  // `deriveProfileNameFromModel` keeps only the last `/`-separated segment, so
  // flatten the runtime prefix and any provider path into it first.
  return deriveProfileNameFromModel(
    `${draft.server}-${modelId.replace(/\//g, "-")}`,
  );
}
