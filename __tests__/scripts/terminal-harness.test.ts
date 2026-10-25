/**
 * The terminal interface, where it can be held to something without a stack.
 *
 * The frame reader and the renderer are the two places a protocol detail went
 * wrong while this was being built against a real conversation, so they are
 * where the fixtures below come from: each one is a frame or an event captured
 * from an actual turn, not an imagined shape.
 */

import { describe, expect, it } from "vitest";

import {
  colourEnabled,
  renderBuilderShare,
  renderEvent,
  renderTranscript,
} from "../../scripts/tui/render.mjs";
import { readFrame, settledStatusOf } from "../../scripts/tui/stream.mjs";
import { PARITY_ACTIONS, parityReport } from "../../scripts/tui/parity.mjs";
import { CONTEXT, diffLines, unifiedDiff } from "../../scripts/tui/diff.mjs";
import {
  hasAutomation,
  resolveApiKey,
} from "../../scripts/stack-discovery.mjs";

const PLAIN = { colour: false };

describe("reading the envelope protocol", () => {
  it("takes the event out of a durable frame", () => {
    const read = readFrame({
      type: "durable",
      seq: 7,
      event: { kind: "MessageEvent", source: "agent", content: "done" },
    });

    expect(read.events).toHaveLength(1);
    expect(read.delta).toBeNull();
  });

  it("reads a delta as streamed text, not as an event", () => {
    // This is the bug the real conversation exposed: a delta carries
    // `kind: "text"`, so reading `frame.kind` as an event kind printed the
    // reply as the line "· text".
    const read = readFrame({
      type: "delta",
      item_id: "efba7349",
      order: 0,
      kind: "text",
      content: "ok",
    });

    expect(read.delta).toBe("ok");
    expect(read.events).toEqual([]);
  });

  it("ignores the frames that are not work", () => {
    for (const frame of [
      { type: "sync", from_seq: -1 },
      { type: "item_started", item_id: "x", attempt: 1, anchor_seq: 5 },
      // A full-state snapshot: thousands of characters nobody asked for.
      { type: "transient", event: { key: "full_state", value: {} } },
    ]) {
      const read = readFrame(frame);
      expect(read.events).toEqual([]);
      expect(read.delta).toBeNull();
      expect(read.unknown).toBeNull();
    }
  });

  it("names a frame type it has never seen rather than dropping it", () => {
    // Silence reads as an idle agent.
    expect(readFrame({ type: "something_new" }).unknown).toBe("something_new");
  });

  it("recognises the conversation saying it has stopped", () => {
    const stopped = {
      kind: "ConversationStateUpdateEvent",
      key: "execution_status",
      value: "finished",
    };

    // Read from the conversation's own state rather than a quiet socket: the
    // socket stays open across a finished turn, so waiting for it to close
    // means waiting forever.
    expect(settledStatusOf(stopped)).toBe("finished");
    expect(settledStatusOf({ ...stopped, value: "running" })).toBeNull();
    expect(settledStatusOf({ ...stopped, key: "stats" })).toBeNull();
  });
});

describe("rendering what an agent did", () => {
  it("shows the answer rather than the tool that carried it", () => {
    const finish = {
      kind: "ActionEvent",
      tool_name: "finish",
      action: { kind: "FinishAction", message: "hello" },
    };

    // "⚙ finish" is the one line that tells the reader nothing about what
    // they asked for.
    expect(renderEvent(finish, PLAIN)).toEqual(["hello"]);
  });

  it("does not print an answer twice when it already streamed", () => {
    const finish = {
      kind: "ActionEvent",
      id: "efba7349",
      action: { kind: "FinishAction", message: "ok" },
    };

    expect(renderEvent(finish, { ...PLAIN, alreadyStreamed: true })).toEqual(
      [],
    );
  });

  it("renders an ACP tool call from the runtime's own words", () => {
    // Captured shape: one event per state, with `title` as the call.
    const call = {
      kind: "ACPToolCallEvent",
      tool_call_id: "exec-1",
      title: "git status -sb",
      tool_kind: "execute",
      status: "in_progress",
    };

    expect(renderEvent(call, PLAIN)).toEqual(["⚙ git status -sb"]);
    expect(
      renderEvent({ ...call, status: "failed", is_error: true }, PLAIN),
    ).toEqual(["✗ git status -sb"]);
  });

  it("collapses a finished call to one line in a transcript", () => {
    const events = [
      {
        kind: "ACPToolCallEvent",
        tool_call_id: "e1",
        title: "pytest",
        status: "in_progress",
      },
      {
        kind: "ACPToolCallEvent",
        tool_call_id: "e1",
        title: "pytest",
        status: "completed",
      },
    ];

    // Two lines is what a reader wants while work happens and not what they
    // want afterwards, where it doubles the transcript for no information.
    expect(renderTranscript(events, PLAIN)).toEqual(["✓ pytest"]);
  });

  it("shows a runtime switch as one notice and nothing more", () => {
    const lines = renderEvent(
      {
        kind: "ACPRuntimeSwitchEvent",
        from_server: "claude-code",
        to_server: "codex",
        to_model: "gpt-5.5",
        reason: "usage_limit",
        reset_hint: { at: "2026-10-29T20:00:00Z" },
      },
      PLAIN,
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("claude-code ran out of usage");
    expect(lines[0]).toContain("continuing on codex");
  });

  it("names an event kind it has never seen", () => {
    expect(renderEvent({ kind: "SomethingNewEvent" }, PLAIN)).toEqual([
      "· SomethingNewEvent",
    ]);
  });

  it("does not render a structured value as [object Object]", () => {
    const lines = renderEvent(
      {
        kind: "ConversationStateUpdateEvent",
        key: "stats",
        value: { tokens: 12 },
      },
      { ...PLAIN, verbose: true },
    );

    expect(lines[0]).toContain('{"tokens":12}');
  });

  it("honours NO_COLOR", () => {
    expect(colourEnabled({ NO_COLOR: "1" }, true)).toBe(false);
    expect(colourEnabled({}, true)).toBe(true);
    expect(colourEnabled({}, false)).toBe(false);
  });
});

describe("the parity checklist", () => {
  it("reports no action as needing a browser", () => {
    // This is the milestone's own measure: zero items requiring a drop to the
    // web interface. Asserted on the report a person actually reads, so an
    // action that regresses to web-only fails here rather than going quiet.
    const report = parityReport().join("\n");

    expect(report).toContain(
      `${PARITY_ACTIONS.length} of ${PARITY_ACTIONS.length} actions work here.`,
    );
    expect(report).not.toContain("Still needs a browser");
  });

  it("names a gap and its reason when there is one", () => {
    // The branch that renders a gap still has to work: an item regressing to
    // web-only must print with its reason, not vanish from the list.
    const report = parityReport([
      { id: "start", action: "Start work", where: "terminal", how: "oh work" },
      {
        id: "draw",
        action: "Draw on the canvas",
        where: "web_only",
        how: "the editor is a pointer surface with no terminal equivalent",
      },
    ]).join("\n");

    expect(report).toContain("1 of 2 actions work here.");
    expect(report).toContain("Still needs a browser:");
    expect(report).toContain(
      "· Draw on the canvas — the editor is a pointer surface with no terminal equivalent",
    );
  });

  it("covers every action the milestone's MVP asks for", () => {
    // start, stream, interrupt, approve a tool call, read history.
    const inTerminal = new Set(
      PARITY_ACTIONS.filter((item) => item.where === "terminal").map(
        (item) => item.id,
      ),
    );

    for (const id of ["start", "stream", "interrupt", "approve", "history"]) {
      expect(inTerminal.has(id), id).toBe(true);
    }
  });

  it("gives every web-only item a reason rather than a blank", () => {
    // An item marked web_only is a gap with a reason, which is the honest
    // thing to show someone deciding whether to open a browser.
    PARITY_ACTIONS.filter((item) => item.where === "web_only").forEach(
      (item) => {
        expect(item.how.length, item.id).toBeGreaterThan(20);
      },
    );
  });

  it("has a unique id per action", () => {
    const ids = PARITY_ACTIONS.map((item) => item.id);

    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("finding the stack", () => {
  it("prefers an explicit key over the persisted one", async () => {
    await expect(resolveApiKey({ OH_STACK_API_KEY: "explicit" })).resolves.toBe(
      "explicit",
    );
    await expect(
      resolveApiKey({ LOCAL_BACKEND_API_KEY: "pinned" }),
    ).resolves.toBe("pinned");
  });

  it("reads the automation service off what the stack says it serves", () => {
    // Read rather than probed: a probe that got a 404 cannot tell "not
    // running" from "running, wrong path".
    // The shape /server_info actually returns.
    expect(
      hasAutomation({
        runtime_services: {
          mode: "dev:automation",
          services: { agent_server: {}, automation: { url_from_agent: "x" } },
        },
      }),
    ).toBe(true);
    // And the flatter one an older stack sends.
    expect(
      hasAutomation({ runtime_services: { automation: { url: "x" } } }),
    ).toBe(true);
    expect(
      hasAutomation({ runtime_services: { services: { agent_server: {} } } }),
    ).toBe(false);
    expect(hasAutomation({})).toBe(false);
    expect(hasAutomation(null)).toBe(false);
  });
});

describe("computing a diff the server does not send", () => {
  // `/api/git/diff` answers with the two versions of a file, not with a
  // diff: the web client builds its own side-by-side view from them. A
  // terminal wants the unified form, so it is computed here.

  it("shows a changed line as a removal and an addition", () => {
    const lines = unifiedDiff("x.txt", "a\nb\nc\n", "a\nB\nc\n");

    expect(lines).toContain("-b");
    expect(lines).toContain("+B");
    expect(lines[0]).toBe("diff --git a/x.txt b/x.txt");
  });

  it("says nothing at all when nothing changed", () => {
    // An empty answer rather than a header with no hunks: a diff that prints
    // a file name and no change reads as a change nobody can see.
    expect(unifiedDiff("x.txt", "same\n", "same\n")).toEqual([]);
  });

  it("collapses the untouched middle of a file", () => {
    const before = Array.from({ length: 40 }, (_, n) => `line ${n}`).join("\n");
    const after = before
      .replace("line 2", "LINE 2")
      .replace("line 37", "LINE 37");

    const lines = unifiedDiff("x.txt", `${before}\n`, `${after}\n`);

    // Two changes forty lines apart are two hunks, not one that prints the
    // whole file — a diff nobody reads.
    expect(lines.filter((line) => line.startsWith("@@"))).toHaveLength(2);
    expect(lines.length).toBeLessThan(2 * (2 * CONTEXT + 2) + 6);
  });

  it("handles a file that was empty, and one that became empty", () => {
    expect(unifiedDiff("new.txt", "", "hello\n")).toContain("+hello");
    expect(unifiedDiff("gone.txt", "hello\n", "")).toContain("-hello");
  });

  it("does not report a trailing newline as a changed blank line", () => {
    // A trailing newline terminates the last line; treating it as an empty
    // line would show every file as having one blank line changed.
    expect(unifiedDiff("x.txt", "a\nb\n", "a\nb\n")).toEqual([]);
  });

  it("refuses a pair too large to diff, rather than hanging on it", () => {
    const huge = Array.from({ length: 5000 }, (_, n) => `line ${n}`).join("\n");

    const lines = unifiedDiff("big.txt", huge, `${huge}\nextra`);

    expect(lines.join("\n")).toContain("too large to diff here");
  });

  it("keeps a context line between the changes it sits between", () => {
    // The real case that exposed this: one unchanged line between two runs of
    // additions. It was buffered as trailing context and printed after both,
    // which reads as the additions going somewhere they did not.
    const lines = unifiedDiff(
      "calc.py",
      "def add(a, b):\n    return a + b\n",
      'def add(a, b):\n    """Sum."""\n    return a + b\n\n\ndef sub(a, b):\n    return a - b\n',
    );

    const body = lines.slice(
      lines.findIndex((line) => line.startsWith("@@")) + 1,
    );
    expect(body[0]).toBe(" def add(a, b):");
    expect(body[1]).toBe('+    """Sum."""');
    expect(body[2]).toBe("     return a + b");
  });

  it("produces a hunk that applies back to the new file", () => {
    // The contract of a diff is that applying it reproduces the file. Checked
    // directly, because a hunk can be internally consistent, carry the right
    // counts in its header, and still describe a different file.
    const before = "one\ntwo\nthree\nfour\nfive\n";
    const after = "one\nTWO\nthree\nfour\nFIVE\nsix\n";

    const applied = applyUnified(before, unifiedDiff("x.txt", before, after));

    expect(applied).toBe(after);
  });

  it("keeps the operations in the order the file reads", () => {
    const operations = diffLines(["a", "b"], ["a", "c", "b"]);

    expect(operations.map((entry) => entry.op + entry.text)).toEqual([
      " a",
      "+c",
      " b",
    ]);
  });
});

/**
 * Apply a unified diff to its "before", so a hunk can be checked against the
 * only thing that makes it correct.
 *
 * Only what `unifiedDiff` emits: one file, hunk headers with 1-based starts.
 */
function applyUnified(before: string, lines: string[]): string {
  const source = before.endsWith("\n")
    ? before.slice(0, -1).split("\n")
    : before.split("\n");
  const out: string[] = [];
  let cursor = 0;
  let index = 0;
  while (index < lines.length) {
    const header = /^@@ -(\d+),\d+ \+\d+,\d+ @@/.exec(lines[index]);
    if (!header) {
      index += 1;
      continue;
    }
    const start = Number(header[1]) - 1;
    out.push(...source.slice(cursor, start));
    cursor = start;
    index += 1;
    while (index < lines.length && !lines[index].startsWith("@@")) {
      const line = lines[index];
      if (line.startsWith(" ")) {
        out.push(source[cursor]);
        cursor += 1;
      } else if (line.startsWith("-")) {
        cursor += 1;
      } else if (line.startsWith("+")) {
        out.push(line.slice(1));
      }
      index += 1;
    }
  }
  out.push(...source.slice(cursor));
  return out.length ? `${out.join("\n")}\n` : "";
}

describe("reading whether the rotation is even", () => {
  const SHARE = {
    window_days: 7,
    days_covered: 7,
    evenness_gap: 8.3,
    target_gap: 20,
    within_target: true,
    runtimes: [
      { runtime: "claude-code", cycles: 12, share: 0.4 },
      { runtime: "codex", cycles: 10, share: 0.3333 },
      { runtime: "antigravity", cycles: 8, share: 0.2667 },
    ],
    unattributed_cycles: 0,
    misattributed_cycles: 0,
    work_redone: 0,
    handoffs_waiting: 0,
    handoffs_unsaved: 0,
  };

  it("tells a target not yet answerable from one that failed", () => {
    // Three states, not two. A gap measured over three days says nothing
    // about a target defined over seven, and printing it as a failure is how
    // a number nobody can act on gets acted on.
    const partial = renderBuilderShare(
      { ...SHARE, days_covered: 3, within_target: null, evenness_gap: 25.4 },
      { name: "rotating", colour: false },
    ).join("\n");
    const failed = renderBuilderShare(
      { ...SHARE, within_target: false, evenness_gap: 25.4 },
      { name: "rotating", colour: false },
    ).join("\n");

    expect(partial).toContain("3 of 7 days have cycles");
    expect(partial).not.toContain("outside target");
    expect(failed).toContain("outside target");
  });

  it("names every fault it has, and nothing in place of the ones it has not", () => {
    // The handoffs that lost their branch are the measure that sat at zero
    // for a week while five of six handoffs preserved nothing, so it is the
    // one that has to be legible here.
    const lines = renderBuilderShare(
      { ...SHARE, handoffs_unsaved: 2, work_redone: 0 },
      { name: "rotating", colour: false },
    ).join("\n");

    expect(lines).toContain("2 handoff(s) lost their branch");
    expect(lines).not.toContain("redid handed-over work");
    expect(lines).toContain("claude-code 40% (12)");
  });

  it("says nothing at all about a program with no cycles in the window", () => {
    // An empty table under a heading reads as "this ran and produced
    // nothing", which is a different claim from "it has not run".
    expect(renderBuilderShare({ ...SHARE, runtimes: [] })).toEqual([]);
  });
});
