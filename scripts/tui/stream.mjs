/**
 * Watching one conversation as it happens.
 *
 * The socket is the live view and REST is the history; the two overlap, so
 * frames are deduped by event id. Reconnecting is left to the caller: the
 * cursor it hands back is what makes a reconnect resume rather than replay.
 *
 * `ws` is already a dependency of this repository's launcher plumbing, so this
 * adds nothing new.
 */

import WebSocket from "ws";
import { renderEvent, renderPermission } from "./render.mjs";

/** How long to wait for the socket to open before giving up on it. */
export const OPEN_TIMEOUT_MS = 15000;

/**
 * Statuses that mean the agent has stopped and will not start again on its
 * own, so a follower can return.
 *
 * Read from the conversation's own state updates rather than guessed from a
 * quiet socket: a socket stays open across a finished turn, so waiting for it
 * to close means waiting forever.
 */
export const SETTLED_STATUSES = new Set([
  "finished",
  "error",
  "paused",
  "stopped",
  "idle",
]);

/** Whether this event says the conversation has stopped, and how. */
export function settledStatusOf(event) {
  if (event?.kind !== "ConversationStateUpdateEvent") return null;
  if (event.key !== "execution_status") return null;
  const value = String(event.value ?? "").toLowerCase();
  return SETTLED_STATUSES.has(value) ? value : null;
}

/**
 * Follow a conversation, printing as it goes.
 *
 * @param {object} client
 * @param {string} conversationId
 * @param {object} options
 * @param {(line: string) => void} options.write
 * @param {(request: object) => void} [options.onPermission]
 * @param {(event: object) => void} [options.onEvent]
 * @param {boolean} [options.colour]
 * @param {boolean} [options.verbose]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ seen: number, lastSeq: number | null, closed: string }>}
 */
export function followConversation(client, conversationId, options) {
  const { write, colour = true, verbose = false, signal } = options;
  const seen = new Set();
  /** Item ids whose text already arrived as deltas. */
  const streamed = new Set();
  let lastSeq = null;

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(client.webSocketUrl(conversationId));
    let status = null;
    const settle = (closed) =>
      resolve({
        seen: seen.size,
        lastSeq,
        closed,
        status,
        streamedAny: streamed.size > 0,
      });

    const opening = setTimeout(() => {
      socket.terminate();
      reject(
        new Error(
          `The event socket did not open within ${OPEN_TIMEOUT_MS}ms. ` +
            "The stack answered on HTTP, so this is the socket path or the " +
            "session key rather than the stack being down.",
        ),
      );
    }, OPEN_TIMEOUT_MS);

    signal?.addEventListener("abort", () => socket.close(1000, "interrupted"), {
      once: true,
    });

    socket.on("open", () => {
      clearTimeout(opening);
      const auth = client.webSocketAuthFrame();
      if (auth) socket.send(auth);
    });

    socket.on("message", (raw) => {
      let frame;
      try {
        frame = JSON.parse(raw.toString());
      } catch {
        // Not dropped: a frame this build cannot read is still evidence that
        // something happened, and silence here reads as an idle agent.
        write(`· unreadable frame (${raw.length} bytes)`);
        return;
      }
      const read = readFrame(frame);
      if (read.unknown) write(`· frame "${read.unknown}"`);
      if (read.delta !== null) {
        // Streamed in place, the way the native harnesses do it. The item id
        // is remembered so the durable event that follows does not print the
        // same answer a second time.
        options.onDelta?.(read.delta);
        streamed.add(read.itemId);
        return;
      }
      for (const event of read.events) {
        if (typeof event?.seq === "number") lastSeq = event.seq;
        const id = event?.id;
        if (id) {
          if (seen.has(id)) continue;
          seen.add(id);
        }
        if (isPermissionRequest(event)) {
          renderPermission(event, colour).forEach(write);
          options.onPermission?.(event);
          continue;
        }
        renderEvent(event, {
          colour,
          verbose,
          // The answer arrives twice: once streamed, once on the durable
          // FinishAction. Printing both would show it twice.
          alreadyStreamed: streamed.has(event.id),
        }).forEach(write);
        options.onEvent?.(event);
        const settled = settledStatusOf(event);
        if (settled && options.untilSettled !== false) {
          // Closed by this side rather than waited out: the turn is over and
          // a follower that kept waiting would look like work still running.
          status = settled;
          socket.close(1000, "settled");
        }
      }
    });

    socket.on("error", (error) => {
      clearTimeout(opening);
      reject(error);
    });
    socket.on("close", (code) => {
      clearTimeout(opening);
      settle(String(code));
    });
  });
}

/**
 * What one envelope frame means.
 *
 * Captured from a real conversation rather than inferred. The frame types are:
 *
 *   sync          the handshake, carrying where the cursor starts
 *   durable       one persisted event, with its sequence number
 *   transient     a `full_state` snapshot — thousands of characters of state
 *                 the reader did not ask for
 *   item_started  a streaming item begins; its id is the id the eventual
 *                 durable event will have
 *   delta         a chunk of that item's text, which is the reply arriving
 *
 * Reading `frame.kind` as an event kind was wrong and visible: a `delta`
 * carries `kind: "text"`, so the reply printed as the line `· text`.
 *
 * @returns {{ events: object[], delta: string | null, unknown: string | null }}
 */
export function readFrame(frame) {
  const empty = { events: [], delta: null, unknown: null };
  if (!frame || typeof frame !== "object") return empty;
  switch (frame.type) {
    case "sync":
    case "item_started":
      return empty;
    case "durable":
      return frame.event ? { ...empty, events: [frame.event] } : empty;
    case "transient":
      // A full-state snapshot. Not an event anyone reads as one, and printing
      // it would bury the work.
      return empty;
    case "delta":
      return frame.kind === "text" && typeof frame.content === "string"
        ? { ...empty, delta: frame.content, itemId: frame.item_id }
        : empty;
    default:
      if (Array.isArray(frame.events)) {
        return { ...empty, events: frame.events };
      }
      if (frame.kind) return { ...empty, events: [frame] };
      // A frame type this build has never seen. Named rather than dropped:
      // silence reads as an idle agent.
      return { ...empty, unknown: String(frame.type ?? "?") };
  }
}

/** Whether this event is the agent waiting for permission to run something. */
export function isPermissionRequest(event) {
  if (!event || typeof event !== "object") return false;
  if (event.kind === "ActionEvent" && event.confirmation_state === "pending") {
    return true;
  }
  return event.kind === "UserConfirmationRequest";
}
