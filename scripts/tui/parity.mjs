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
  {
    id: "start",
    action: "Start work",
    where: "terminal",
    how: "oh work <prompt>",
  },
  {
    id: "continue",
    action: "Continue work",
    where: "terminal",
    how: "oh say <id> <text>",
  },
  {
    id: "stream",
    action: "Watch it as it happens",
    where: "terminal",
    how: "oh work / oh follow <id>",
  },
  {
    id: "attach",
    action: "Attach to work already running",
    where: "terminal",
    how: "oh follow <id>",
  },
  {
    id: "interrupt",
    action: "Interrupt a turn without losing the work",
    where: "terminal",
    how: "Ctrl-C while following, or oh stop <id>",
  },
  {
    id: "approve",
    action: "Approve a tool call",
    where: "terminal",
    how: "answer the prompt while following, or oh allow <id>",
  },
  {
    id: "reject",
    action: "Reject a tool call, with a reason",
    where: "terminal",
    how: "oh deny <id> <why>",
  },
  {
    id: "history",
    action: "Read a full transcript",
    where: "terminal",
    how: "oh history <id>",
  },
  {
    id: "list",
    action: "See what conversations exist",
    where: "terminal",
    how: "oh list",
  },
  {
    id: "graph",
    action: "See what every agent is doing",
    where: "terminal",
    how: "oh graph",
  },
  {
    id: "parked",
    action: "See work parked for a person",
    where: "terminal",
    how: "oh waiting",
  },
  {
    id: "resolve",
    action: "Answer a parked breaking change",
    where: "terminal",
    how: "oh waiting <id> <route> <why>",
  },
  {
    id: "runtime-switch",
    action: "See a runtime switch mid-task",
    where: "terminal",
    how: "shown as one notice on the stream; the work carries on",
  },
  {
    id: "budget",
    action: "Read which runtimes have usage left",
    where: "terminal",
    how: "oh budget",
  },
  {
    id: "diffs",
    action: "Read a change as a diff",
    where: "terminal",
    how: "oh diff [path] [ref]",
  },
  {
    id: "automations",
    action: "Read improvement programs, and create one",
    where: "terminal",
    how: "oh programs / oh programs new <file.json>",
  },
  {
    id: "canvas",
    action: "Author the map's drawn layer",
    where: "terminal",
    // Not the freeform pointer editor — that is a pointer surface. This is
    // the other half: the drawn layer is a committed document, and editing it
    // from here makes it scriptable, which the pointer surface is not.
    how: "oh map / oh map add <kind> <label> / oh map link <from> <to> / oh map rm <id>",
  },
];

/** The checklist, as the lines `oh parity` prints. */
export function parityReport(actions = PARITY_ACTIONS) {
  const here = actions.filter((item) => item.where === "terminal");
  const web = actions.filter((item) => item.where === "web_only");
  const lines = [`${here.length} of ${actions.length} actions work here.`, ""];
  here.forEach((item) => lines.push(`  ✓ ${item.action} — ${item.how}`));
  if (web.length > 0) {
    lines.push("", "Still needs a browser:");
    web.forEach((item) => lines.push(`  · ${item.action} — ${item.how}`));
  }
  return lines;
}
