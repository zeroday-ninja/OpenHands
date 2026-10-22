/**
 * What the agent is told about a selection.
 *
 * This is prompt text, not interface copy, so it is English program text in
 * one named place rather than a translated string — the same way
 * `getSkillChatLaunchMessage` builds its slash command. It is also shown to
 * the user verbatim before anything is sent: the difference between this
 * feature feeling precise and feeling like magic is that you can read exactly
 * what went along with your question.
 *
 * Every line names the node's kind, label and path, because those are the
 * three things that let an agent find the subject without guessing, and
 * because a path is what makes "change this" unambiguous.
 */

import {
  PROJECT_MAP_FILE_PATH,
  type ProjectMapDocument,
  type ProjectMapNode,
} from "#/types/project-map";

/** Why a conversation is being started from the map. */
export type ProjectMapIntent = "ask" | "change" | "redesign";

/** The skill a redesign is seeded with, invoked by naming it first. */
const DESIGN_SKILL_COMMAND = "/frontend-design";

export interface ProjectMapContextOptions {
  /** The commit the open document was generated against, when it says. */
  commit: string | null;
}

/** One line per selected node: kind, label, path. */
export function describeProjectMapNode(node: ProjectMapNode): string {
  const where = node.path === null ? "no file" : node.path;
  return `- ${node.kind} "${node.label}" (${where})`;
}

/**
 * The context block appended to a message sent from the map. Empty selection
 * yields an empty string so the composer sends a plain question.
 */
export function buildProjectMapContextBlock(
  nodes: readonly ProjectMapNode[],
  options: ProjectMapContextOptions,
): string {
  if (nodes.length === 0) return "";
  const provenance =
    options.commit === null
      ? PROJECT_MAP_FILE_PATH
      : `${PROJECT_MAP_FILE_PATH}, generated against ${options.commit}`;
  return [
    `Selected on the project map (${provenance}):`,
    ...nodes.map(describeProjectMapNode),
    "",
    `You can edit ${PROJECT_MAP_FILE_PATH} to change the map itself — grouping, labels, hidden nodes and positions all live in that file. Keep every node's x, y, pinned, hidden, group and any label whose label_source is "user".`,
  ].join("\n");
}

const INTENT_OPENING: Record<ProjectMapIntent, string> = {
  ask: "Explain the selection below: what it does, what depends on it, and anything surprising about how it fits together.",
  change: "I want to change the selection below. Read the files first, then tell me what you plan to do before you do it.",
  redesign:
    "I want to redesign the selection below. It is user-facing, so treat the visual result as the deliverable.",
};

/**
 * The whole first message for a conversation launched from the map: the
 * intent, the selection, and — for a redesign — the design skill, invoked by
 * leading the message with its slash command, which is how a conversation
 * loads a catalog skill the profile did not select.
 */
export function buildProjectMapLaunchMessage(
  intent: ProjectMapIntent,
  nodes: readonly ProjectMapNode[],
  options: ProjectMapContextOptions,
): string {
  const prefix = intent === "redesign" ? `${DESIGN_SKILL_COMMAND} ` : "";
  const block = buildProjectMapContextBlock(nodes, options);
  const body = block === "" ? INTENT_OPENING[intent] : `${INTENT_OPENING[intent]}\n\n${block}`;
  return `${prefix}${body}`;
}

/** A question typed in the map's composer, with the selection attached. */
export function buildProjectMapQuestionMessage(
  question: string,
  nodes: readonly ProjectMapNode[],
  options: ProjectMapContextOptions,
): string {
  const block = buildProjectMapContextBlock(nodes, options);
  const trimmed = question.trim();
  if (block === "") return trimmed;
  return trimmed === "" ? block : `${trimmed}\n\n${block}`;
}

/**
 * Nodes an answer mentions, so the chat can link them back to the canvas.
 *
 * Matching is on the path and on the id, never on the label: a label like
 * "home" would light up half the map. Longest first, so `src/routes/home.tsx`
 * wins over `src/routes`.
 */
export function findProjectMapMentions(
  text: string,
  document: ProjectMapDocument,
): ProjectMapNode[] {
  const candidates = document.nodes
    .map((node) => ({ node, needle: node.path ?? node.id }))
    .filter(({ needle }) => needle.length >= 3)
    .sort((left, right) => right.needle.length - left.needle.length);
  const found: ProjectMapNode[] = [];
  const matched: string[] = [];
  for (const { node, needle } of candidates) {
    if (!text.includes(needle)) continue;
    // A parent directory is a prefix of its children, so naming
    // `src/routes/home.tsx` must not also light up `src/routes`.
    if (matched.some((longer) => longer.includes(needle))) continue;
    matched.push(needle);
    found.push(node);
  }
  return found;
}
