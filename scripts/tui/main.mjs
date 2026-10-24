/**
 * The terminal interface: the same work, without a browser.
 *
 * Not a monitor. Every command here is something a person does rather than
 * something they watch, and the parity checklist in `parity.mjs` is what holds
 * it to that — an action that still needs the web interface is a listed gap,
 * not an omission nobody noticed.
 *
 * Routing is transparent by construction: a runtime that runs out mid-task
 * shows as one notice and the work carries on, because the switch is a typed
 * event on the same stream as everything else.
 */

import process from "node:process";
import readline from "node:readline";
import { discoverStack, StackNotFound } from "../stack-discovery.mjs";
import { createClient } from "./client.mjs";
import { colourEnabled, paint, renderTranscript } from "./render.mjs";
import { followConversation } from "./stream.mjs";
import { PARITY_ACTIONS, parityReport } from "./parity.mjs";

const USAGE = `oh — Agent Canvas from the terminal

  oh work [prompt...]        start work and follow it
  oh follow <id>             attach to a conversation in flight
  oh say <id> <text...>      send a message to one
  oh stop <id>               interrupt the turn; the conversation survives
  oh allow <id> | oh deny <id> [reason...]
                             answer a tool call it is waiting on
  oh history <id>            print the whole transcript
  oh list                    conversations, newest first
  oh graph                   what every agent is doing right now
  oh waiting                 work parked for you, and answer it
  oh budget                  which runtimes have usage left
  oh parity                  what this can do, and what it cannot
  oh where                   which stack this is talking to

Environment:
  OH_AGENT_PROFILE_ID  which agent profile answers (and so which runtime)
  OH_WORKING_DIR       where work happens; defaults to the current directory
  OH_STACK_URL       a stack somewhere other than loopback
  OH_STACK_API_KEY   its session key, if not the persisted one
  NO_COLOR           plain output
`;

export async function main(argv = process.argv.slice(2), io = process) {
  const write = (line) => io.stdout.write(`${line}\n`);
  const [command, ...rest] = argv;

  if (!command || command === "help" || command === "--help") {
    write(USAGE);
    return 0;
  }
  if (command === "parity") {
    parityReport().forEach(write);
    return 0;
  }

  let stack;
  try {
    stack = await discoverStack(io.env ?? process.env);
  } catch (error) {
    if (error instanceof StackNotFound) {
      write(error.message);
      return 2;
    }
    throw error;
  }
  const client = createClient(stack);
  const colour = colourEnabled(io.env ?? process.env, io.stdout?.isTTY);

  switch (command) {
    case "where":
      write(`${stack.baseUrl}  v${stack.info?.version ?? "?"}`);
      write(
        `automation ${stack.automation ? "reachable" : "not reachable — the work graph, parked work and budget are unavailable"}`,
      );
      return 0;

    case "list": {
      const payload = await client.listConversations(20);
      const items = payload?.items ?? payload ?? [];
      if (items.length === 0) {
        write("No conversations yet. `oh work <what you want>` starts one.");
        return 0;
      }
      items.forEach((item) => {
        write(
          `${paint(item.id, "dim", colour)}  ${item.execution_status ?? "?"}  ${
            item.title ?? "(untitled)"
          }`,
        );
      });
      return 0;
    }

    case "history": {
      const id = requireId(rest[0], write);
      if (!id) return 2;
      const { events, truncated } = await client.allEvents(id);
      renderTranscript(events, { colour, verbose: false }).forEach(write);
      if (truncated) {
        // Said out loud: a transcript missing its tail reads as a
        // conversation that ended there.
        write(paint("· transcript truncated; there is more", "yellow", colour));
      }
      return 0;
    }

    case "say": {
      const id = requireId(rest[0], write);
      if (!id) return 2;
      const text = rest.slice(1).join(" ");
      if (!text) {
        write("Nothing to say. `oh say <id> <text>`");
        return 2;
      }
      await client.sendMessage(id, text);
      await startAgent(client, id, write, colour);
      return followUntilIdle(client, id, { write, colour });
    }

    case "stop": {
      const id = requireId(rest[0], write);
      if (!id) return 2;
      await client.pause(id);
      write("Interrupted. The conversation is intact; `oh say` carries on.");
      return 0;
    }

    case "allow":
    case "deny": {
      const id = requireId(rest[0], write);
      if (!id) return 2;
      await client.respondToConfirmation(
        id,
        command === "allow",
        rest.slice(1).join(" ") || undefined,
      );
      write(command === "allow" ? "Allowed." : "Rejected.");
      return followUntilIdle(client, id, { write, colour });
    }

    case "follow": {
      const id = requireId(rest[0], write);
      if (!id) return 2;
      return followUntilIdle(client, id, { write, colour, verbose: true });
    }

    case "work": {
      const prompt = rest.join(" ");
      // `workspace` is the only required field, and the profile decides which
      // runtime answers — named by env rather than guessed, because starting
      // work on a runtime the user did not choose spends their credit.
      const profile = (io.env ?? process.env).OH_AGENT_PROFILE_ID;
      const created = await client.createConversation({
        // `LocalWorkspace`, spelled as the discriminator rather than "local":
        // the server rejects anything else with "Docker conversations require
        // a local workspace", which reads as a mode problem and is actually
        // this field.
        workspace: {
          kind: "LocalWorkspace",
          working_dir:
            (io.env ?? process.env).OH_WORKING_DIR || process.cwd(),
        },
        ...(profile ? { agent_profile_id: profile } : {}),
        // Deliberately *without* the prompt. An `initial_message` starts the
        // agent as the conversation is created, which is before the secrets
        // below can land — and an ACP runtime with no login fails its first
        // turn with ACPAuthRequired. Create, hand over the secrets, then ask.
      });
      const id = created?.id ?? created?.conversation?.id;
      if (!id) {
        write(`The stack created something without an id: ${JSON.stringify(created).slice(0, 200)}`);
        return 1;
      }
      write(paint(id, "dim", colour));
      // An ACP runtime's login is a secret, so a conversation started without
      // them fails with ACPAuthRequired before it does anything. The profile
      // decides which ones it may see; the values never pass through here.
      if (profile) {
        try {
          const secrets = await client.secretsFor(profile);
          if (Object.keys(secrets).length > 0) {
            await client.setSecrets(id, secrets);
          }
        } catch (error) {
          // Said rather than swallowed: the conversation will fail on auth
          // and this is the reason, which is not otherwise visible.
          write(
            paint(`· could not pass the profile's secrets: ${error.message}`, "yellow", colour),
          );
        }
      }
      if (prompt) {
        await client.sendMessage(id, prompt);
        await startAgent(client, id, write, colour);
      }
      return followUntilIdle(client, id, { write, colour });
    }

    case "graph":
      return await showGraph(client, write, colour);

    case "waiting":
      return await showWaiting(client, write, colour, rest);

    case "budget":
      return await showBudget(client, write, colour);

    default:
      write(`Unknown command: ${command}\n\n${USAGE}`);
      return 2;
  }
}

/**
 * Get the agent going on what it has been sent.
 *
 * A message sits in the conversation until something runs it, and which call
 * does that depends on where the conversation is: a paused one resumes, an
 * idle one runs. A 409 means it is already running, which is not a failure —
 * the message it was just sent will be picked up by the turn in flight.
 */
async function startAgent(client, id, write, colour) {
  try {
    // `/run` is also what resumes a paused conversation: the server has no
    // separate resume for a conversation, only `goal/resume` for a goal.
    await client.run(id);
  } catch (error) {
    if (error?.status !== 409) throw error;
    // Already running. Not a failure: the message just sent will be picked
    // up by the turn in flight.
    write(
      paint(
        "· already running; the message joins the turn in flight",
        "dim",
        colour,
      ),
    );
  }
}

function requireId(value, write) {
  if (!value) {
    write("Which conversation? Try `oh list`.");
    return null;
  }
  return value;
}

/**
 * Follow a conversation and answer tool calls from the keyboard.
 *
 * Interruption is Ctrl-C, which pauses the turn rather than killing the
 * process: the point of an interrupt is that the work survives it.
 */
async function followUntilIdle(client, id, { write, colour, verbose = false }) {
  const controller = new AbortController();
  const onSigint = () => {
    controller.abort();
    void client.pause(id).catch(() => {});
    write(paint("↯ interrupted — the conversation is intact", "yellow", colour));
  };
  process.once("SIGINT", onSigint);
  try {
    const result = await followConversation(client, id, {
      write,
      colour,
      verbose,
      // Streamed without a newline, so a reply arrives as it is written
      // rather than all at once when the turn ends.
      onDelta: (chunk) => process.stdout.write(chunk),
      onPermission: async (request) => {
        const answer = await askOne();
        if (answer === null) return;
        await client.respondToConfirmation(id, answer !== "n").catch((error) => {
          write(`Could not answer that: ${error.message}`);
        });
      },
    });
    if (result.streamedAny) process.stdout.write("\n");
    if (result.status === "error") {
      // The transcript already carries the error event. This is the exit
      // code, which is what a script wrapping this reads.
      return 1;
    }
    if (result.status === null && !controller.signal.aborted) {
      // The socket ended without the conversation saying it had stopped, so
      // what happened is genuinely unknown. Saying so beats implying it
      // finished.
      write(
        paint(
          `· the stream ended without the conversation reporting a status (${result.closed})`,
          "yellow",
          colour,
        ),
      );
    }
    return 0;
  } finally {
    process.off("SIGINT", onSigint);
  }
}

/** One keystroke answer to a permission prompt, or null when not interactive. */
function askOne() {
  if (!process.stdin.isTTY) return Promise.resolve(null);
  const rl = readline.createInterface({ input: process.stdin });
  return new Promise((resolve) => {
    rl.once("line", (line) => {
      rl.close();
      resolve(line.trim().slice(0, 1).toLowerCase() || "y");
    });
  });
}

async function showGraph(client, write, colour) {
  if (!client.stack.automation) {
    write("The automation service is not reachable through this stack.");
    return 2;
  }
  const graph = await client.automation("GET", "/work-graph");
  const working = (graph?.nodes ?? []).filter(
    (node) => node.status === "in_flight",
  );
  const waiting = (graph?.nodes ?? []).filter(
    (node) => node.status === "waiting",
  );
  write(
    `${graph?.nodes?.length ?? 0} nodes · ${graph?.in_flight ?? 0} in flight · ${waiting.length} waiting on you`,
  );
  [...working, ...waiting].forEach((node) => {
    write(
      `${paint(node.status, node.status === "waiting" ? "yellow" : "blue", colour)}  ${node.kind}  ${node.label}`,
    );
  });
  (graph?.omissions ?? []).forEach((omission) => {
    // The omissions are the point of the export: a view of autonomous work
    // that cannot say "I do not know" is worse than no view.
    write(paint(`· ${omission.kind}: ${omission.detail}`, "dim", colour));
  });
  return 0;
}

async function showWaiting(client, write, colour, rest) {
  if (!client.stack.automation) {
    write("The automation service is not reachable through this stack.");
    return 2;
  }
  const [cycleId, route, ...reason] = rest;
  if (cycleId && route) {
    const text = reason.join(" ");
    if (!text) {
      // The service requires it, and so does this: an answer with no
      // reasoning has to be guessed at again next time.
      write("Say why: `oh waiting <id> <approve|cycle|return|archive> <why>`");
      return 2;
    }
    await client.automation("POST", `/improve/cycles/${cycleId}/resolve`, {
      route,
      resolution: text,
    });
    write("Answered. The cycle carries on from where it stopped.");
    return 0;
  }

  const payload = await client.automation("GET", "/improve/parked");
  const cycles = payload?.cycles ?? [];
  if (cycles.length === 0) {
    write("Nothing is waiting on you.");
    return 0;
  }
  cycles.forEach((cycle) => {
    write(
      `${paint(cycle.id, "dim", colour)}  ${cycle.repository?.label ?? "?"}  ${
        cycle.change_class ?? "?"
      }`,
    );
    write(`  ${cycle.parked_question ?? cycle.summary ?? ""}`);
    const plan = cycle.parked_plan ?? {};
    (plan.breaks ?? []).forEach((line) => write(`    breaks: ${line}`));
    if (plan.rollback) write(`    rollback: ${plan.rollback}`);
  });
  write(
    paint(
      "Answer with: oh waiting <id> <approve|cycle|return|archive> <why>",
      "dim",
      colour,
    ),
  );
  return 0;
}

async function showBudget(client, write, colour) {
  if (!client.stack.automation) {
    write("The automation service is not reachable through this stack.");
    return 2;
  }
  const payload = await client.automation("GET", "/improve/parked");
  // The ledger has no read endpoint of its own yet, so what can honestly be
  // shown is what the cycles recorded. Said plainly rather than rendered as
  // though it were the ledger.
  write(
    "The runtime ledger has no read endpoint yet; this is what the cycles reported.",
  );
  const seen = new Map();
  (payload?.cycles ?? []).forEach((cycle) => {
    (cycle.runtime_switches ?? []).forEach((hop) => {
      if (hop.reason === "usage_limit") seen.set(hop.from, hop.at);
    });
  });
  if (seen.size === 0) {
    write("No runtime has reported running out.");
    return 0;
  }
  seen.forEach((at, runtime) => {
    write(`${paint(runtime, "yellow", colour)} ran out at ${at}`);
  });
  return 0;
}

export { PARITY_ACTIONS };
