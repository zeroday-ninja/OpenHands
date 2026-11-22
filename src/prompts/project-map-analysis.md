Build or refresh this repository's project map at `.openhands/project-map.json`.

The project map is a readable picture of the codebase that a person rearranges by hand and reads beside a chat. It is a committed document, not a live dependency graph. Your job is the analysis; the arrangement belongs to whoever opens it.

## Before you write anything

1. Read the existing `.openhands/project-map.json` if there is one. You are refreshing it, not replacing it.
2. Find the commit you are describing: `git rev-parse --short HEAD`.
3. Work out what this repository actually is, from its README, its entry points, its package or project manifest, and its directory shape. Do not map a framework's conventions onto a project that does not use them.

## What to put in it

Aim for the 40–120 nodes a person can hold in their head, not every file. A node earns its place by being something a maintainer would name out loud in a conversation about this codebase. Prefer one node per meaningful module, page, service, store, table or job; collapse a directory of small files that are only ever used together into one `dir` node for the directory.

- `id` — the repository-relative path, or `ext:<name>` for something outside the repository (a hosted API, a database, a third-party service). This is the node's identity and the reason a user's layout survives your next pass: never renumber or restyle an id that still refers to the same thing.
- `kind` — one of `dir`, `module`, `route`, `component`, `hook`, `service`, `store`, `endpoint`, `table`, `job`, `external`. The kind decides the shape the node is drawn as, so choose the one a reader would guess from the drawing.
- `label` — the short human name, two or three words at most. Not the filename if the filename is noise.
- `summary` — one sentence saying what it is for. Write it for someone who has never opened the file. Say what it does, not what it imports.
- `size` — the file's line count, or the total for a `dir` node. This drives how much weight the node carries on the canvas, so a rough number is fine and a missing one makes the drawing lie.
- `tags` — optional, for things worth filtering on later: `entry`, `generated`, `deprecated`, `hot-path`.
- `path` — the same repository-relative path, or `null` for an external or conceptual node.
- `group` — the id of a group below.

Group nodes into the four to eight layers a maintainer of this repository would actually name — "web app", "transport", "persistence", "background work". Name a layer after the folder, package or feature its maintainers already call it by — `web/`, `server/`, the persistence package — and invent a name only when no folder or package says it: a reader who knows the repository by its folders should recognise every layer at a glance. Give each group an `id`, a `label` and an `accent` as a string holding a number from `"1"` to `"6"`; the accent is an index into the reader's theme palette, never a colour.

Edges say what talks to what. Each one is `{ "from": <node id>, "to": <node id>, "kind": <kind> }` with an optional `label`; `from` and `to` are the fields the reader accepts, and both must name a node by its `id`. Use the narrowest kind that is true:

- `imports` — a structural dependency that is not itself a runtime event.
- `renders` — a component or page that puts another on screen.
- `calls` — one module invoking another's behaviour.
- `reads` / `writes` — access to stored state: a store, a table, a file, a cache.
- `routes-to` — a URL or route resolving to what handles it.
- `publishes` — emitting an event or message whose consumer is elsewhere.

Leave out edges that are true but say nothing: a utility imported by forty files makes a hairball, not a picture. If a node would need more than about eight edges, that is a sign the node should be a group instead.

Give every node an `x` and `y`. Lay the groups out left to right in the order a request travels through them, nodes within a group top to bottom heaviest first, with roughly 260 units between columns and 96 between rows. A first drawing that reads correctly is worth the extra effort — it is the one the user will start rearranging.

Optionally add `notes`: each is `{ "id": <short slug>, "text": <the remark>, "anchor": <node id or null> }`, a short remark about the node it is anchored to. Use them for the things a newcomer gets wrong, not for restating a summary.

## The rule that matters most

**Preserve everything the user decided.** For every node whose `id` already exists in the file on disk, carry over, unchanged:

- `x`, `y` and `pinned` — where they put it;
- `hidden` — what they decided is noise;
- `group` — which layer they decided it belongs to, even if you would have grouped it differently;
- `label` **when the node has `"label_source": "user"`** — they renamed it. Keep the `label_source` field too.

Carry over every entry in `notes`, and every existing group's `label`, `accent` and `collapsed`, including groups you would not have created. Only genuinely new nodes get coordinates from you.

If you are unsure whether a node is the same thing under a new path, it is not — give it the new id and let the old one drop out.

## Finishing

Write the file with `"version": 1`, `generated_at` as an ISO 8601 instant, and `commit` set to the short SHA you read at the start. Two-space indent; the file is committed and its diffs are read by people.

Then tell the user, in four or five lines: how many nodes and groups the map has, which layers you named, what you deliberately left out, and anything about this codebase that surprised you while you were reading it. That last part is usually the most useful sentence in the whole exercise.
