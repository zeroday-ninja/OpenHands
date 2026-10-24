/**
 * Turning an agent's event stream into lines on a terminal.
 *
 * Hand-rolled, like the launcher's own output: a terminal-UI framework would
 * be a new pinned dependency under the seven-day age rule, for a job that is
 * a few hundred characters of ANSI.
 *
 * The shape follows the native harnesses rather than the web transcript: a
 * tool call is one line that fills in, a reply streams in place, and a thought
 * is dimmed. What matters is that *nothing is dropped* — an event kind this
 * build has never seen prints as itself, because a silent drop is how a
 * terminal ends up looking idle while work is happening.
 */

const ANSI = {
  reset: "\u001b[0m",
  dim: "\u001b[2m",
  bold: "\u001b[1m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  blue: "\u001b[34m",
  magenta: "\u001b[35m",
  cyan: "\u001b[36m",
};

/** Whether to emit colour at all. Honours NO_COLOR, which users expect. */
export function colourEnabled(env = process.env, isTty = process.stdout.isTTY) {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "0") return true;
  return Boolean(isTty);
}

export function paint(text, colour, enabled = true) {
  if (!enabled || !ANSI[colour]) return text;
  return `${ANSI[colour]}${text}${ANSI.reset}`;
}

/** Longest a single rendered line gets before it is cut. */
export const MAX_LINE = 2000;

function clamp(text, limit = MAX_LINE) {
  // An object stringifies to "[object Object]", which tells the reader
  // nothing. Several of these fields carry structured values.
  const raw =
    text !== null && typeof text === "object"
      ? safeJson(text)
      : String(text ?? "");
  const flat = raw.replace(/\s+$/, "");
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return "(unserialisable)";
  }
}

/**
 * One event, as the lines a terminal should print for it.
 *
 * Returns `[]` only for events that are genuinely nothing to show — never for
 * one this build does not recognise, which gets a line naming its kind.
 *
 * @param {object} event
 * @param {object} [options]
 * @param {boolean} [options.colour]
 * @param {boolean} [options.verbose]
 * @param {boolean} [options.alreadyStreamed] True when this event's text
 *   already arrived as deltas, so printing it again would show the answer
 *   twice.
 * @returns {string[]}
 */
export function renderEvent(event, options = {}) {
  const colour = options.colour !== false;
  const kind = event?.kind;
  const c = (text, name) => paint(text, name, colour);

  switch (kind) {
    case "MessageEvent": {
      const text = messageText(event);
      if (!text) return [];
      if (event.source === "user") {
        return [`${c("›", "cyan")} ${clamp(text)}`];
      }
      return [clamp(text)];
    }
    case "ActionEvent": {
      // A FinishAction is the agent's answer, not a tool call. Shown as the
      // answer, because `⚙ finish` is the one line that tells the reader
      // nothing about what they asked for.
      if (event.action?.kind === "FinishAction") {
        const answer = clamp(event.action.message ?? "");
        if (!answer) return [];
        // Skipped when it already streamed: the reply arrives twice, once as
        // deltas and once on this event.
        return options.alreadyStreamed ? [] : [answer];
      }
      const name = event.tool_name || event.action?.kind || "tool";
      const detail = actionDetail(event);
      return [
        `${c("⚙", "blue")} ${c(name, "bold")}${detail ? ` ${c(detail, "dim")}` : ""}`,
      ];
    }
    case "ACPToolCallEvent": {
      // What an ACP runtime actually emits, which is one event per state
      // rather than a call and an observation. Captured from a real
      // conversation: `title` is the call in the runtime's own words,
      // `tool_kind` is what sort it is, and `status` moves from in_progress
      // to completed or failed on later events with the same tool_call_id.
      const title = clamp(event.title || event.tool_kind || "tool", 160);
      if (event.is_error || event.status === "failed") {
        return [`${c("✗", "red")} ${title}`];
      }
      if (event.status === "completed") {
        return options.verbose ? [`${c("✓", "green")} ${title}`] : [];
      }
      // The in-progress line is the one worth always showing: it is what
      // tells a reader the agent is working rather than stuck.
      return [`${c("⚙", "blue")} ${title}`];
    }
    case "SystemPromptEvent":
      // The prompt itself is thousands of characters of context the reader
      // did not ask for. Its presence is the only interesting part.
      return options.verbose ? [c("· system prompt sent", "dim")] : [];
    case "ConversationStateUpdateEvent":
      // Bookkeeping: which message was last, which status applies. Shown only
      // when asked for, because one of these per turn would drown the work.
      return options.verbose
        ? [c(`· ${event.key} = ${clamp(event.value, 80)}`, "dim")]
        : [];
    case "ObservationEvent": {
      const name = event.tool_name || "tool";
      // The finish tool's observation echoes the answer that was just shown.
      if (name === "finish" && !options.verbose) return [];
      const failed = event.observation?.error || event.error;
      if (failed) {
        return [`${c("✗", "red")} ${name}: ${clamp(String(failed), 400)}`];
      }
      if (!options.verbose) return [];
      return [`${c("✓", "green")} ${name}`];
    }
    case "AgentThoughtEvent": {
      const text = messageText(event);
      return text ? [c(clamp(text, 400), "dim")] : [];
    }
    case "ACPRuntimeSwitchEvent": {
      // The notice the plan asks for: a runtime change is visible and the
      // conversation carries on. Nothing about it interrupts the work.
      const reason =
        event.reason === "usage_limit"
          ? "ran out of usage"
          : "switched by hand";
      const reset = event.reset_hint?.at
        ? `, back at ${event.reset_hint.at}`
        : "";
      return [
        c(
          `↻ ${event.from_server} ${reason}${reset} — continuing on ${event.to_server}` +
            (event.to_model ? ` (${event.to_model})` : ""),
          "yellow",
        ),
      ];
    }
    case "ConversationErrorEvent":
      return [
        `${c("✗", "red")} ${event.code || "error"}: ${clamp(event.detail, 600)}`,
      ];
    case "UserRejectObservation":
      return [c("✗ you rejected that", "yellow")];
    case "CondensationRequest":
    case "Condensation":
      return options.verbose ? [c("· history condensed", "dim")] : [];
    default:
      if (!kind) return [];
      // A kind this build has never seen. Printed rather than dropped: a
      // terminal that goes quiet during work is indistinguishable from one
      // whose work has stopped.
      return [c(`· ${kind}`, "dim")];
  }
}

function messageText(event) {
  const content = event?.llm_message?.content ?? event?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (typeof part === "string" ? part : part?.text || ""))
    .filter(Boolean)
    .join("");
}

function actionDetail(event) {
  const action = event?.action;
  if (!action || typeof action !== "object") return "";
  // The one field that says what a call is about, per tool. Chosen rather
  // than dumping the arguments: a terminal line is one line.
  for (const field of [
    "command",
    "path",
    "file_path",
    "url",
    "query",
    "pattern",
  ]) {
    const value = action[field];
    if (typeof value === "string" && value) return clamp(value, 160);
  }
  return "";
}

/** A tool call awaiting an answer, as the prompt a person reads. */
export function renderPermission(request, colour = true) {
  const name = request?.tool_name || "a tool call";
  const detail = actionDetail(request) || "";
  return [
    paint(`? ${name} wants to run`, "magenta", colour),
    detail ? `  ${paint(detail, "dim", colour)}` : "",
    `  ${paint("[y] allow  [n] reject  [a] allow everything", "dim", colour)}`,
  ].filter(Boolean);
}

/**
 * A whole transcript, as opposed to a live stream.
 *
 * The difference is tool calls. A runtime emits one event per state, so a
 * finished call appears twice — which is what a reader wants while work is
 * happening ("started… done") and not what they want afterwards, where it
 * doubles the length of the transcript for no information. Here each call is
 * collapsed to its final state.
 *
 * @param {object[]} events  Oldest first.
 * @param {object} [options]
 * @param {boolean} [options.colour]
 * @param {boolean} [options.verbose]
 * @returns {string[]}
 */
export function renderTranscript(events, options = {}) {
  const finalState = new Map();
  events.forEach((event) => {
    if (event?.kind === "ACPToolCallEvent" && event.tool_call_id) {
      finalState.set(event.tool_call_id, event);
    }
  });
  const emitted = new Set();
  const lines = [];
  events.forEach((event) => {
    if (event?.kind === "ACPToolCallEvent" && event.tool_call_id) {
      if (emitted.has(event.tool_call_id)) return;
      emitted.add(event.tool_call_id);
      // The final state, rendered where the call *started*, so the order
      // still reads as the order the work happened in.
      const last = finalState.get(event.tool_call_id);
      lines.push(...renderEvent(last, { ...options, verbose: true }));
      return;
    }
    lines.push(...renderEvent(event, options));
  });
  return lines;
}

/**
 * A unified diff, coloured the way every diff reader colours one.
 *
 * Hand-rolled for the same reason the rest of this is: a syntax-highlighting
 * dependency to put three colours on three prefixes is not a trade worth
 * making, and the three prefixes are the whole of what a reader needs.
 */
export function renderDiff(diff, colour = true) {
  // Accepts the lines `unifiedDiff` produces, or a diff as one string.
  const lines = Array.isArray(diff)
    ? diff
    : typeof diff === "string" && diff.trim()
      ? diff.split("\n")
      : [];
  return lines.map((line) => {
    if (line.startsWith("+++") || line.startsWith("---")) {
      return paint(line, "bold", colour);
    }
    if (line.startsWith("+")) return paint(line, "green", colour);
    if (line.startsWith("-")) return paint(line, "red", colour);
    if (line.startsWith("@@")) return paint(line, "cyan", colour);
    if (line.startsWith("diff --git")) return paint(line, "bold", colour);
    return line;
  });
}
