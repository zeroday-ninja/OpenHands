# Agent Canvas from the terminal

`oh` does the same work the web interface does, without a browser. It is not a
monitor: every command is something you do rather than something you watch.

```sh
npx agent-canvas   # or npm run dev, in this repo
oh work "pin the parser to the patched release"
```

## Finding the stack

Nothing documented this before, which is why every host-side tool so far
hard-coded a port and a key path. The rules are in
`scripts/stack-discovery.mjs` and they are the ones the launchers already
follow:

| Looked at | For |
|---|---|
| `OH_STACK_URL` | a stack somewhere other than loopback |
| `OH_STACK_API_KEY`, then `LOCAL_BACKEND_API_KEY` | an explicitly pinned key |
| `~/.openhands/agent-canvas/api-key.txt` | the key the launcher persisted so the agent-server, the Vite build and the browser all agree |
| `config/defaults.json` → `ports.proxy` on `127.0.0.1` and `[::1]` | the stack a local `npm run dev` started |

Giving a URL and no key still resolves the key from the list above: pointing at
another host does not mean you want a different credential.

A stack that cannot be found is reported **with every URL that was tried**,
because "could not connect" without the URL is the bug report nobody can act
on.

`oh where` prints what it found, including whether the automation service is
reachable — the work graph, parked work and budget all depend on that, and it
is better to say so than to fail three commands later.

## Commands

```
oh work [prompt...]        start work and follow it
oh follow <id>             attach to work already running
oh say <id> <text...>      send a message to it
oh stop <id>               interrupt the turn; the conversation survives
oh allow <id> | oh deny <id> [reason...]
oh history <id>            the whole transcript
oh diff [path] [ref]       what changed in a working tree, as a diff
oh programs [new <file>]   improvement programs, and create one
oh list                    conversations, newest first
oh graph                   what every agent is doing
oh waiting                 work parked for you — and `oh waiting <id> <route> <why>` answers it
oh budget                  which runtimes have usage left
oh parity                  what this can do, and what it cannot
oh where                   which stack this is talking to
```

`OH_AGENT_PROFILE_ID` chooses which agent profile answers, and so which
runtime. It is named rather than guessed because starting work on a runtime you
did not choose spends your credit. `OH_WORKING_DIR` is where work happens and
defaults to the current directory.

## What it cannot do

`oh parity` is the checklist, and it is asserted by a test rather than kept in
prose, so an action that regresses to web-only shows up as a failure.

**One** thing still needs a browser: drawing on the canvas. A freeform diagram
editor is not a terminal surface, and pretending otherwise would be worse than
saying so. A gap with a reason is the honest thing to show someone deciding
whether to open one.

## Diffs

`/api/git/diff` answers with the two *versions* of a file rather than with a
diff — the web client builds its own side-by-side view from them. So `oh diff`
lists what changed, fetches each file's before and after, and computes the
unified form itself: a plain LCS in `scripts/tui/diff.mjs`, bounded at four
thousand lines, because a diff library would be a new pinned dependency under
the seven-day age rule and this is forty lines.

## Creating a program

From a file, not from flags: the configuration has a rotation, a reviewer list,
a judge and a repository source that constrain each other, so a flag per field
would be a worse version of the JSON the service already validates — and it
would drift from it. The service generates the runner tarball itself.

```sh
oh programs new nightly.json   # {"name", "trigger", "improve"}
```

## Starting work: the order matters

Three things were learned by driving this against a real stack, and they are
why the code looks the way it does:

1. **`workspace.kind` is `"LocalWorkspace"`**, the class name, not `"local"`.
   The server rejects anything else with "Docker conversations require a local
   workspace", which reads as a mode problem and is actually this field.
2. **Secrets go on *before* the first message.** An `initial_message` starts
   the agent as the conversation is created, which is before any secret can
   land — and an ACP runtime's login *is* a secret, so its first turn fails
   with `ACPAuthRequired`. The order is create, hand over the secrets, then
   ask. The values never pass through this process: what is handed over is a
   lookup reference the agent server resolves itself.
3. **Sending is not running.** A message sits in the conversation until
   something runs it; in the browser the socket does that. `oh` posts to
   `/run`, and a 409 from it means the conversation is already running, which
   is not a failure — the message joins the turn in flight. There is no
   conversation-level resume: `/run` is what resumes a paused one.

## The stream

The socket is `/sockets/session/{id}` and it speaks an envelope protocol:

| Frame | Means |
|---|---|
| `sync` | the handshake, with where the cursor starts |
| `durable` | one persisted event, with its sequence number |
| `transient` | a `full_state` snapshot — not shown, it is thousands of characters nobody asked for |
| `item_started` | a streaming item begins; its id is the id the eventual durable event will have |
| `delta` | a chunk of that item's text, which is the reply arriving |

The key detail: a `delta` carries `kind: "text"`, so reading `frame.kind` as an
event kind prints the reply as the line `· text`. That happened, and the
fixtures in `__tests__/scripts/terminal-harness.test.ts` are the frames that
exposed it.

The reply arrives twice — streamed as deltas, then on the durable
`FinishAction` — so the second is suppressed when the first already printed it.

A frame type or event kind this build has never seen is **named, not dropped**.
A terminal that goes quiet during work is indistinguishable from one whose work
has stopped.

## A runtime switch is one line

```
↻ claude-code ran out of usage, back at 2026-10-29T20:00:00Z — continuing on codex (gpt-5.5)
```

Nothing about it interrupts the work. The switch is a typed event on the same
stream as everything else, which is what makes it visible here without the
terminal knowing anything about credit.

## Interrupting

Ctrl-C while following pauses the turn rather than killing the process: the
point of an interrupt is that the work survives it. `oh say` then carries on
from where it stopped. `oh stop <id>` does the same from another shell.
