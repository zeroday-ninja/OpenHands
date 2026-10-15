# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

The rules above (from `AGENTS.md`) are authoritative. This file adds commands and architecture context only.

## Contributor skills are files, not Claude Code skills

`AGENTS.md` says to "invoke" skills under `.agents/skills/`. Claude Code does not register these, so they are not available through the Skill tool. Instead, read `.agents/skills/<name>/SKILL.md` and its `references/guide.md` before you change that area. Every PR must also follow `.agents/skills/custom-codereview-guide.md`.

## Commands

Node >= 24. Install with `npm ci`.

```sh
npm run dev            # full local stack: agent-server + automation (via uvx), Vite, ingress at :8000
npm run dev:minimal    # agent-server + Vite only, no automation/ingress (http://localhost:3001)
npm run dev:mock       # frontend only against MSW mocks (VITE_MOCK_API=true)
npm run dev:frontend   # frontend only against an existing backend

npm run lint           # react-router typegen + tsc + eslint src + prettier --check
npm run lint:fix
npm test               # make-i18n, then vitest run (jsdom + node projects)
npm run build          # standalone SPA (react-router build, ssr: false)
npm run build:lib      # library entrypoints (BUILD_LIB=true vite build + tsconfig.lib.json)
npm run build:mock     # mock-enabled build; use it to verify static mock mode
```

Run a single test file or test name:

```sh
npm test -- __tests__/api/agent-server-config.test.ts
npx vitest run __tests__/hooks/use-websocket.test.ts -t "<test name substring>"
```

`src/i18n/declaration.ts` is generated and gitignored. Calling `npx vitest` or `tsc` directly fails on `#/i18n/declaration` imports until `npm run make-i18n` has run once. `npm test`, `npm run lint`, and the builds run it for you.

E2E suites use Playwright: `npm run test:e2e`, `test:e2e:mock-llm`, `test:e2e:mock-llm:docker`, and `test:e2e:live`. Read the `e2e-testing` skill files before choosing or changing a suite.

The pre-commit hook runs lint-staged: eslint --fix, prettier, a staged typecheck, and translation completeness on `src/**`.

## Architecture

Agent Canvas is a client-only React 19 SPA built with React Router 7 framework mode (`ssr: false`; routes are in `src/routes.ts`). It runs no agents itself. It drives one or more **OpenHands Agent Servers** (Python, from `software-agent-sdk`) and, optionally, an **Automation Server**. The same source also ships as an npm library for embedding (`src/index.ts` → `src/lib`) and as an Electron desktop app (`electron/`). Use the `#/` import alias for `src/`.

### Backends and transport

- **Backend registry** (`src/api/backend-registry/`): the user can register several backends, each `kind: "local" | "cloud"`. The active backend, plus an org for Cloud, is resolved through `active-store.ts` and `src/contexts/active-backend-context.tsx`. A "local" backend is any directly reachable Agent Server, even a remote one. "cloud" means the OpenHands Cloud App API.
- **Agent Server calls** must go through typed classes from `@openhands/typescript-client` (`ConversationClient`, `FileClient`, `RemoteWorkspace`, `RemoteEventsList`, …). Build their options with `getAgentServerClientOptions()` / `getAgentServerHttpClientOptions()` in `src/api/agent-server-client-options.ts`, which read host, session key, and working dir from the active backend.
- **Cloud App-API calls** go through `callCloudProxy()` in `src/api/cloud/proxy.ts`. Per-conversation Cloud runtime sandboxes are reached directly with the typed client, the same way as local.
- `src/api/no-direct-agent-server-calls.test.ts` fails CI on raw `axios`/`fetch` to `/api/*`, apart from a small allow-list. If an endpoint is missing, it belongs in the TypeScript client (another repo), not here.
- Connecting to an Agent Server older than `compatibility.minimumAgentServer` in `config/defaults.json` is rejected (`src/api/agent-server-compatibility.ts`).

### Data flow layers

- `src/api/<feature>-service/`: plain-object services that wrap typed clients (see `src/api/README.md`). Cloud equivalents live in `src/api/cloud/*.api.ts`.
- `src/hooks/query/` and `src/hooks/mutation/`: TanStack Query wrappers. Components never call services directly. Query keys must come from `src/hooks/query/query-keys.ts`; a lint rule enforces this.
- `src/stores/`: Zustand stores for client and conversation state (events, agent state, browser, commands, UI prefs).
- Live conversations: `src/contexts/conversation-websocket-context.tsx` opens the Agent Server WebSocket, classifies incoming events with type guards, and fans them out to Zustand stores (`use-event-store`, `conversation-state-store`, …) and React Query caches. UI components render from those stores.
- `src/mocks/`: MSW handlers. They back `dev:mock`/`build:mock` and are started for every jsdom test in `vitest.setup.ts`.

### Local stack (scripts/, bin/)

`npm run dev`, `dev:static`, the published `agent-canvas` binary (`bin/agent-canvas.mjs`), and the Docker image share launch plumbing in `scripts/`:

- `dev-with-automation.mjs`, `dev-safe.mjs`, and `dev-static.mjs` launch the stack.
- `ingress.mjs` and `static-server.mjs` provide a single-origin proxy on :8000. They also inject `runtime_services` into `/server_info` and the session key into served HTML.
- Version pins for agent-server and automation, ports, and paths come from `config/defaults.json`. Override the backend source with `OH_AGENT_SERVER_LOCAL_PATH`, `OH_AGENT_SERVER_GIT_REF`, or `OH_AGENT_SERVER_VERSION`, and the `OH_AUTOMATION_*` equivalents (details in `docs/DEVELOPMENT.md`).
- Dev state is isolated under `.openhands-dev/`.

### Embedding and CSS scoping

All bundled CSS is scoped under a `[data-agent-server-ui]` root. Host apps use `AgentServerUIProviders` / `AgentServerUIRoot` and override theme tokens through CSS custom properties (`--oh-*`). Use `bg-canvas-base` / `text-canvas-base` for the base surface color. `text-base` is only the Tailwind font size.

### Tests layout

- Most unit and component tests live in `__tests__/`, mirroring `src/`. Some are co-located as `src/**/*.test.ts(x)`.
- Vitest runs two projects (configured in `vite.config.ts`). DOM-free suites listed explicitly in `NODE_ENV_PILOT_TESTS` run under `node` without `vitest.setup.ts`. Everything else runs under `jsdom` with MSW.
- `test-utils.tsx` provides `renderWithProviders` and event factories.
- Playwright specs live in `tests/e2e/`.

## Further reading

- `docs/architecture.md`
- `docs/DEVELOPMENT.md`: env vars, cross-repo version sequencing, mutation testing.
- `specs/`: feature specs referenced by `// @spec` tags.
