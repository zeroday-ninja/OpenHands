# Project map interactions — before and after, in the running app

Temporary review evidence for `fix/project-map-interactions`. It is removed in a
later commit on this branch; link it at the commit that added it.

Everything here comes from one isolated stack built from this checkout, driven
with `control-openhands` (`.agents/skills/verify-openhands/`) — a real Agent
Server, a real frontend build, the deterministic
`control-openhands fixture project-map` document. No LLM is involved: nothing on
this page needs a model. "Before" is this branch with
`project-map-canvas.tsx` and `project-map-node-plate.tsx` restored to `main`,
rebuilt and restarted on the same stack; "after" is the branch head.

```sh
export PATH="$PWD/.agents/skills/verify-openhands/scripts:$PATH"
control-openhands launch --new
control-openhands onboard --skip
control-openhands fixture project-map
control-openhands browser goto /map
```

## 1. The pan travelled half as far as the pointer

The viewport is the `translate(x y) scale(s)` on the canvas's transform group.
A drag of `D` screen pixels must move `translate` by exactly `D`, at any scale.

```sh
READ='document.querySelector("[data-testid=\"project-map-canvas\"] > g[transform]").getAttribute("transform")'
control-openhands browser eval "$READ"
control-openhands browser drag 'testid=project-map-canvas' --by 200,0 --steps 12
control-openhands browser eval "$READ"
```

| | start | after a 200 px drag | travelled |
|---|---|---|---|
| before | `translate(56.00000000000003 276.5565927654609) scale(0.6977829638273045)` | `translate(156.00000000000026 …)` | **100 px** |
| after | `translate(56.00000000000003 276.5565927654609) scale(0.6977829638273045)` | `translate(256.00000000000006 …)` | **200 px** |

`before-pan-200px-moved-100px.png` · `after-pan-200px-moved-200px.png`

How far it landed used to depend on how many moves the drag was delivered in,
because each move was measured against the viewport the previous move had
already shifted. On the branch head it does not:

```
steps=1    translate(256.00000000000006 276.5565927654609) scale(0.6977829638273045)
steps=2    translate(256.00000000000006 276.5565927654609) scale(0.6977829638273045)
steps=5    translate(256.00000000000006 276.5565927654609) scale(0.6977829638273045)
steps=12   translate(256.00000000000006 276.5565927654609) scale(0.6977829638273045)
steps=20   translate(256.00000000000006 276.5565927654609) scale(0.6977829638273045)
```

(each reading is a fresh 200 px drag from the same start, dragged back in
between; the scale is unchanged throughout, and `project-map-unsaved` stays
absent — the view is not part of the document.)

No motion capture: this machine has no ffmpeg with libx264, and Playwright's
bundled build ships only `libvpx-vp9`, which `browser record` does not accept.
The transform readings above are the measurement a video would be used to
estimate.

## 2. Mouse selection could not be cleared

```sh
control-openhands browser click 'testid=project-map-node-qa/docs'
control-openhands browser click 'testid=project-map-node-qa/src/stores/things.ts' --modifiers Shift
control-openhands browser click 'testid=project-map-node-qa/src/stores/things.ts'   # should narrow
control-openhands browser click 'testid=project-map-canvas' --position 30,30        # should clear
control-openhands browser eval 'document.activeElement.getAttribute("data-testid")||document.activeElement.tagName'
```

| | before | after |
|---|---|---|
| chips after the plain click on a selected plate | `QA_Things store\nQA_Docs` | `QA_Things store` |
| chips after the click on empty paper | still present (`count` 1) | gone (`count` 0) |
| `document.activeElement` after that click | `BODY` | `project-map-canvas` |
| Escape afterwards | nothing | clears the selection |

`before-selection-will-not-clear.png` · `after-click-narrows-to-one.png` ·
`after-paper-click-clears.png`

Still working on the branch head, checked on the same stack: shift-drag sweeps a
marquee (`QA_Home route, QA_Panel, QA_Things service, QA_Things store`), and a
plate drag still moves the plate — `translate(720 280)` → `translate(900 360)`,
multiples of the 20-unit grid — and leaves `Unsaved changes`.

## 3. A note can be written and thrown away

`after-note-written.png`: **Add a note** opened the new note's own editor,
`Read this before touching the hook` was typed into it on the canvas, and the ×
on its corner removes it (`project-map-remove-note-<id>`, afterwards `count` 0).

## 4. The smaller ones

- `after-warnings-singular.png` — `control-openhands fixture project-map --variant warnings`:
  `1 connection pointed at a node the map does not contain, and was dropped.`,
  `1 node repeated an id that was already taken, and was ignored.`,
  `1 node named a group the map does not declare, and is now ungrouped.`,
  `1 note lost the node it was about, and now floats free.`
- `after-read-error-names-path.png` — `control-openhands fixture project-map --unreadable`:
  `The map at /tmp/openhands-verify/2026-10-22T1024-a57cd0/private/home/workspace/project/.openhands/project-map.json could not be read.`
  It read `The map at  could not be read.` before.
- The context block now names the same absolute path, read from
  `project-map-context-preview` with a node selected:
  `Selected on the project map (/tmp/openhands-verify/.../workspace/project/.openhands/project-map.json, generated against qa1234c): …`
  `You can edit /tmp/.../.openhands/project-map.json to change the map itself …`
