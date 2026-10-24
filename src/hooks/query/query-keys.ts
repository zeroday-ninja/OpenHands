/**
 * Centralized query keys and cache configuration for TanStack Query.
 * Using constants ensures type safety and prevents typos.
 */

import { SettingsScope } from "#/types/settings";

export const QUERY_KEYS = {
  /** Web client configuration from the server */
  WEB_CLIENT_CONFIG: ["web-client-config"] as const,
  /** Same-origin OpenHands app cookie authentication status */
  MAIN_APP_COOKIE_AUTH: ["main-app-cookie-auth"] as const,
} as const;

export const SETTINGS_QUERY_KEYS = {
  all: ["settings"] as const,
  byScope: (scope: SettingsScope) => ["settings", scope] as const,
  personal: () => ["settings", "personal"] as const,
} as const;

export const LLM_PROFILES_QUERY_KEYS = {
  all: ["llm-profiles"] as const,
} as const;

export const META_PROFILES_QUERY_KEYS = {
  all: ["meta-profiles"] as const,
} as const;

export const ACP_MODEL_DISCOVERY_QUERY_KEYS = {
  all: ["acp-model-discovery"] as const,
} as const;

export const AGENT_PROFILES_QUERY_KEYS = {
  all: ["agent-profiles"] as const,
  // Nested under `all` so profile mutations invalidate cached details too.
  detail: (backendId: string, orgId: string | null | undefined, name: string) =>
    ["agent-profiles", backendId, orgId, "detail", name] as const,
} as const;

/**
 * Git sync, the automations backend's repository mirroring. The single-repo
 * status (`use-git-sync.ts`'s `GIT_SYNC_STATUS_QUERY_KEY`) predates these and
 * keeps its own root; the remotes and assignments share this one so a change
 * to either invalidates both.
 */
export const GIT_SYNC_QUERY_KEYS = {
  all: ["git-sync"] as const,
  remotes: ["git-sync", "remotes"] as const,
  assignments: ["git-sync", "assignments"] as const,
} as const;

/**
 * Improvement programs, the automations backend's repository rotation. Keyed
 * per automation under one root so a write to any part of a program (or a
 * backend switch) invalidates every view of it.
 */
export const IMPROVE_QUERY_KEYS = {
  all: ["improve-program"] as const,
  rotation: (automationId: string, backendId: string, orgId: string | null) =>
    ["improve-program", "rotation", automationId, backendId, orgId] as const,
  cycles: (
    automationId: string,
    page: { limit: number; offset: number },
    backendId: string,
    orgId: string | null,
  ) =>
    [
      "improve-program",
      "cycles",
      automationId,
      page,
      backendId,
      orgId,
    ] as const,
  /**
   * Work waiting for a person, org-wide rather than per program: the question
   * is "what is waiting on me", not "which of this program's cycles are
   * parked", so it is not keyed by automation.
   */
  parked: (backendId: string, orgId: string | null, limit: number) =>
    ["improve-program", "parked", backendId, orgId, limit] as const,
} as const;

/**
 * The user's identity on the active agent server: SOUL.md on its own
 * (`byBackend`) and the whole document set (`documents`). Keyed by backend and
 * org so switching either never shows another server's files.
 *
 * `documents` is nested under `all` on purpose — the set contains SOUL.md, so
 * the two views overlap and a write to either must be able to invalidate both.
 * The literal segment comes first so a backend id can never be mistaken for
 * it.
 */
export const SOUL_QUERY_KEYS = {
  all: ["soul"] as const,
  byBackend: (backendId: string) => ["soul", backendId] as const,
  documents: (backendId: string, orgId: string | null | undefined) =>
    ["soul", "documents", backendId, orgId] as const,
} as const;

/**
 * The work graph, one entry per registered deployment because the view fans
 * out over all of them. Keyed by backend, org, and connection revision so an
 * org switch or a credential edit never folds one deployment's work into
 * another's picture, and by the window asked for, since a different window is
 * different data rather than a stale version of the same data.
 */
export const WORK_GRAPH_QUERY_KEYS = {
  all: ["work-graph"] as const,
  byBackend: (
    backendId: string,
    orgId: string | null,
    connectionRevision: number,
    window: { windowDays: number; limit: number },
  ) => ["work-graph", backendId, orgId, connectionRevision, window] as const,
} as const;

/**
 * The project map document in a workspace. Keyed by backend and by the
 * conversation whose working directory it was resolved from, so switching
 * either never shows another repository's map.
 */
export const PROJECT_MAP_QUERY_KEYS = {
  all: ["project-map"] as const,
  byWorkspace: (backendId: string, conversationId: string | null) =>
    ["project-map", backendId, conversationId] as const,
} as const;

export const TOOL_CATALOG_QUERY_KEYS = {
  all: ["tool-catalog"] as const,
} as const;

export const SKILL_CATALOG_QUERY_KEYS = {
  all: ["skill-catalog"] as const,
} as const;

export const PROVIDER_CONNECTIONS_QUERY_KEYS = {
  all: ["provider-connections"] as const,
} as const;

/** Fail fast when older backends lack the profile endpoint. */
export const AGENT_PROFILES_RETRY_OPTIONS = {
  retry: false,
} as const;

export const LLM_SUBSCRIPTION_QUERY_KEYS = {
  all: ["llm-subscription"] as const,
  openaiStatus: ["llm-subscription", "openai", "status"] as const,
  openaiModels: ["llm-subscription", "openai", "models"] as const,
} as const;

export const LOCAL_WORKSPACES_QUERY_KEYS = {
  all: ["local-workspaces"] as const,
} as const;

export const PLUGINS_QUERY_KEYS = {
  /** Dynamic marketplace catalog (used by `use-plugins-marketplace`). */
  marketplace: ["plugins-marketplace"] as const,
  /** Installed plugins from the local agent-server. */
  installed: ["plugins-installed"] as const,
  /** Locally-discovered ambient plugins (used by `use-local-plugins`). */
  local: ["plugins-local"] as const,
} as const;

export const CANVAS_EXTENSIONS_QUERY_KEYS = {
  all: ["canvas-extensions"] as const,
  installed: (
    backendId: string,
    orgId: string | null,
    connectionRevision: number,
  ) =>
    [
      "canvas-extensions",
      "installed",
      backendId,
      orgId,
      connectionRevision,
    ] as const,
  icon: (
    backendId: string,
    orgId: string | null,
    connectionRevision: number,
    name: string,
  ) =>
    [
      "canvas-extensions",
      "icon",
      backendId,
      orgId,
      connectionRevision,
      name,
    ] as const,
} as const;

export const SUPER_ADMIN_SETUP_QUERY_KEYS = {
  /** Every backend's setup-guide state, for invalidation. */
  all: ["super-admin-setup-state"] as const,
  /** Enterprise Super Admin setup-guide state for a cloud backend. */
  state: (backendId: string, connectionRevision: number) =>
    ["super-admin-setup-state", backendId, connectionRevision] as const,
} as const;

export const SETUP_QUERY_KEYS = {
  /** What the deployment supports. The same answer for every setup entry. */
  capabilities: () => ["setup-capabilities"] as const,
} as const;

export const MARS_QUERY_KEYS = {
  all: ["mars"] as const,
  authState: ["mars", "auth-state"] as const,
  /** Every connection's agent list, for invalidating after a change. */
  allAgents: ["mars", "agents"] as const,
  /** Keyed by connection so switching teams never shows another team's list. */
  agents: (connectionId: string | null) =>
    ["mars", "agents", connectionId] as const,
  /** DigitalOcean's sandbox size catalog; the same for every team. */
  sandboxSizes: ["mars", "sandbox-sizes"] as const,
} as const;

export const APP_UPDATE_QUERY_KEYS = {
  /** Latest published @openhands/agent-canvas version (npm `latest` dist-tag). */
  latestVersion: ["agent-canvas-latest-version"] as const,
  /** Whether the local launcher lets the browser update/restart the stack. */
  control: (backendId: string | null) =>
    ["agent-canvas-control", backendId] as const,
} as const;

export const CONVERSATION_QUERY_KEYS = {
  subConversations: ["v1", "sub-conversations"] as const,
} as const;

export const LOCAL_PLANNER_MUTATION_KEYS = {
  create: ["create-local-planning-conversation"] as const,
} as const;

/** Cache configuration shared across all config-related queries */
export const CONFIG_CACHE_OPTIONS = {
  staleTime: 1000 * 60 * 5, // 5 minutes
  gcTime: 1000 * 60 * 15, // 15 minutes
} as const;
