/**
 * ACP agents select a reasoning effort through a combined ``<model>/<effort>``
 * ``acp_model`` id (``opus/high``, ``gpt-6-astra/max``); the agent-server
 * applies the two as separate session config options. These helpers split and
 * build that id so pickers can show the model and its effort separately.
 */

/**
 * Effort levels recognized in a saved combined id before an agent reports its
 * own; mirrors the agent-server's ``_KNOWN_EFFORT_LEVELS``. Levels an agent
 * reports are always recognized as well.
 */
export const KNOWN_ACP_EFFORT_LEVELS: readonly string[] = [
  "default",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
];

/** The level meaning "the agent's own default"; choosing it adds no suffix. */
export const ACP_DEFAULT_EFFORT = "default";

export interface AcpModelEffort {
  modelId: string | null;
  effort: string | null;
}

export function splitAcpModelEffort(
  id: string | null | undefined,
  reportedEfforts: readonly string[] = [],
): AcpModelEffort {
  const value = id?.trim();
  if (!value) return { modelId: null, effort: null };
  const slash = value.lastIndexOf("/");
  const effort = value.slice(slash + 1);
  if (
    slash > 0 &&
    (KNOWN_ACP_EFFORT_LEVELS.includes(effort) ||
      reportedEfforts.includes(effort))
  ) {
    return { modelId: value.slice(0, slash), effort };
  }
  return { modelId: value, effort: null };
}

export function composeAcpModelEffort(
  modelId: string,
  effort: string | null | undefined,
): string {
  return effort && effort !== ACP_DEFAULT_EFFORT
    ? `${modelId}/${effort}`
    : modelId;
}

/** The levels a picker offers; the agent-default choice is shown separately. */
export function selectableAcpEfforts(
  efforts: readonly string[] | null | undefined,
): string[] {
  return (efforts ?? []).filter((effort) => effort !== ACP_DEFAULT_EFFORT);
}

/** Display label for an agent-reported effort level (``xhigh`` -> ``Xhigh``). */
export function acpEffortLabel(effort: string): string {
  return effort.charAt(0).toUpperCase() + effort.slice(1);
}
