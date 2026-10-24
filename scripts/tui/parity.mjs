/**
 * What the terminal can do, and what it still cannot.
 *
 * The milestone's own measure is "an agreed parity checklist of actions, with
 * zero items requiring a drop to the web interface". A checklist kept in a
 * document would drift; this one is read by `oh parity` and asserted by a
 * test, so an action that regresses to web-only shows up as a failure rather
 * than as a stale sentence.
 *
 * `web_only` is a real answer, not a placeholder. An item marked that way is a
 * gap with a reason, which is the honest thing to show someone deciding
 * whether to open a browser.
 */

/**
 * @typedef {object} ParityAction
 * @property {string} id
 * @property {string} action   What a person wants to do.
 * @property {"terminal" | "web_only"} where
 * @property {string} how      The command, or why it is not here yet.
 */

/** @type {readonly ParityAction[]} */
export const PARITY_ACTIONS = [
  { id: "start", action: "Start work", where: "terminal", how: "oh work <prompt>" },
  { id: "continue", action: "Continue work", where: "terminal", how: "oh say <id> <text>" },
  { id: "stream", action: "Watch it as it happens", where: "terminal", how: "oh work / oh follow <id>" },
  { id: "attach", action: "Attach to work already running", where: "terminal", how: "oh follow <id>" },
  { id: "interrupt", action: "Interrupt a turn without losing the work", where: "terminal", how: "Ctrl-C while following, or oh stop <id>" },
  { id: "approve", action: "Approve a tool call", where: "terminal", how: "answer the prompt while following, or oh allow <id>" },
  { id: "reject", action: "Reject a tool call, with a reason", where: "terminal", how: "oh deny <id> <why>" },
  { id: "history", action: "Read a full transcript", where: "terminal", how: "oh history <id>" },
  { id: "list", action: "See what conversations exist", where: "terminal", how: "oh list" },
  { id: "graph", action: "See what every agent is doing", where: "terminal", how: "oh graph" },
  { id: "parked", action: "See work parked for a person", where: "terminal", how: "oh waiting" },
  { id: "resolve", action: "Answer a parked breaking change", where: "terminal", how: "oh waiting <id> <route> <why>" },
  { id: "runtime-switch", action: "See a runtime switch mid-task", where: "terminal", how: "shown as one notice on the stream; the work carries on" },
  {
    id: "budget",
    action: "Read which runtimes have usage left",
    where: "web_only",
    how: "The runtime-usage ledger has no read endpoint; only what cycles reported is visible. Needs GET /v1/runtime-usage.",
  },
  {
    id: "diffs",
    action: "Read a change as a diff",
    where: "web_only",
    how: "The transcript shows the tool calls that made it. A diff view needs the file service, which is next.",
  },
  {
    id: "automations",
    action: "Create or edit an automation",
    where: "web_only",
    how: "Creating a program posts a generated tarball; the terminal can read programs but not author one.",
  },
  {
    id: "canvas",
    action: "Draw on the canvas",
    where: "web_only",
    how: "A freeform diagram editor is not a terminal surface, and pretending otherwise would be worse than saying so.",
  },
];

/** The checklist, as the lines `oh parity` prints. */
export function parityReport(actions = PARITY_ACTIONS) {
  const here = actions.filter((item) => item.where === "terminal");
  const web = actions.filter((item) => item.where === "web_only");
  const lines = [
    `${here.length} of ${actions.length} actions work here.`,
    "",
  ];
  here.forEach((item) => lines.push(`  ✓ ${item.action} — ${item.how}`));
  if (web.length > 0) {
    lines.push("", "Still needs a browser:");
    web.forEach((item) => lines.push(`  · ${item.action} — ${item.how}`));
  }
  return lines;
}
