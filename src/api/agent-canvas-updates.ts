/**
 * Source of truth for "is a newer Agent Canvas published?".
 *
 * The npm registry `latest` dist-tag endpoint is CORS-open and returns the
 * abbreviated packument for that version as JSON. Isolated here so the
 * release channel can change (e.g. GitHub releases) without touching the
 * query hook or the settings update card.
 */
const NPM_LATEST_VERSION_URL =
  "https://registry.npmjs.org/@openhands/agent-canvas/latest";

export const AGENT_CANVAS_RELEASE_NOTES_URL =
  "https://github.com/OpenHands/OpenHands/releases";

/** Literal shell commands — intentionally not localized. */
export const AGENT_CANVAS_UPDATE_COMMANDS = {
  npm: "npm install -g @openhands/agent-canvas@latest",
  docker: "docker pull ghcr.io/openhands/agent-canvas:latest",
} as const;

export async function fetchLatestAgentCanvasVersion(
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch(NPM_LATEST_VERSION_URL, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`npm registry responded ${response.status}`);
  }
  const body: unknown = await response.json();
  const version = (body as { version?: unknown } | null)?.version;
  if (typeof version !== "string" || !version.trim()) {
    throw new Error("npm registry response missing version");
  }
  return version.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// In-place update and restart of a locally launched stack
// ─────────────────────────────────────────────────────────────────────────────

/** How the launcher can update this install; mirrors scripts/self-update.mjs. */
export type AgentCanvasSelfUpdateMethod = "git-checkout" | "npm-global" | "npx";

export interface AgentCanvasControlInfo {
  /** Id of the running stack; changes when the launcher relaunches. */
  instance: string;
  /** False when the ingress cannot relay requests to its launcher. */
  enabled: boolean;
  /** Version the launcher started with. */
  version?: string;
  self_update: {
    supported: boolean;
    method: AgentCanvasSelfUpdateMethod | null;
    reason: string | null;
  };
  restart: { supported: boolean; reason: string | null };
  status_path: string;
  update_path: string;
  restart_path: string;
}

export type AgentCanvasControlPhase =
  | "idle"
  | "updating"
  | "restarting"
  | "failed";

export interface AgentCanvasControlStatus {
  instance: string;
  enabled: boolean;
  phase: AgentCanvasControlPhase;
  message: string | null;
  updated_at: string;
}

const CONTROL_PATH_PREFIX = "/__agent-canvas";
const CONTROL_KEY_HEADER = "X-Session-API-Key";

/**
 * The control block a local launcher's ingress adds to `/server_info`, or
 * null when this page is not served by such a launcher (Cloud, Docker, a
 * remote Agent Server, `--public`, or an older launcher).
 */
export function parseAgentCanvasControlInfo(
  value: unknown,
): AgentCanvasControlInfo | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Partial<AgentCanvasControlInfo>;
  if (typeof raw.instance !== "string" || !raw.instance) return null;
  const selfUpdate = raw.self_update;
  const restart = raw.restart;
  return {
    instance: raw.instance,
    enabled: raw.enabled !== false,
    version: typeof raw.version === "string" ? raw.version : undefined,
    self_update: {
      supported: selfUpdate?.supported === true,
      method: (selfUpdate?.method as AgentCanvasSelfUpdateMethod) ?? null,
      reason: selfUpdate?.reason ?? null,
    },
    restart: {
      supported: restart?.supported !== false,
      reason: restart?.reason ?? null,
    },
    status_path:
      typeof raw.status_path === "string"
        ? raw.status_path
        : `${CONTROL_PATH_PREFIX}/status`,
    update_path:
      typeof raw.update_path === "string"
        ? raw.update_path
        : `${CONTROL_PATH_PREFIX}/update`,
    restart_path:
      typeof raw.restart_path === "string"
        ? raw.restart_path
        : `${CONTROL_PATH_PREFIX}/restart`,
  };
}

export interface AgentCanvasControlTarget {
  /** Origin of the ingress that serves the page ("" for the page's own). */
  host: string;
  /** The stack's session key, which the control routes require. */
  apiKey: string | null;
}

export class AgentCanvasControlError extends Error {
  readonly status: number;

  /**
   * True when a stack answered but has no control routes: after a restart
   * that is the replacement stack running a launcher without them (an older
   * release, or a newer one that moved them), so the page should reload.
   */
  readonly noControl: boolean;

  constructor(status: number, message: string, noControl = false) {
    super(message);
    this.name = "AgentCanvasControlError";
    this.status = status;
    this.noControl = noControl;
  }
}

async function readControlError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: string;
      status?: { message?: string | null };
    };
    return body.status?.message || body.error || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

/** Ask the launcher to update (`"update"`) or just relaunch (`"restart"`). */
export async function requestAgentCanvasControl(
  target: AgentCanvasControlTarget,
  action: "update" | "restart",
  signal?: AbortSignal,
  { targetVersion = null }: { targetVersion?: string | null } = {},
): Promise<AgentCanvasControlStatus> {
  const path =
    action === "update"
      ? `${CONTROL_PATH_PREFIX}/update`
      : `${CONTROL_PATH_PREFIX}/restart`;
  const response = await fetch(`${target.host}${path}`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(target.apiKey ? { [CONTROL_KEY_HEADER]: target.apiKey } : {}),
    },
    // The release the browser saw on npm, so a checkout can merge its tag.
    body: JSON.stringify(
      action === "update" ? { target_version: targetVersion } : {},
    ),
  });
  if (!response.ok) {
    throw new AgentCanvasControlError(
      response.status,
      await readControlError(response),
    );
  }
  const body = (await response.json()) as { status: AgentCanvasControlStatus };
  return body.status;
}

/** The launcher's progress, from whichever stack currently answers. */
export async function fetchAgentCanvasControlStatus(
  target: AgentCanvasControlTarget,
  signal?: AbortSignal,
): Promise<AgentCanvasControlStatus> {
  const response = await fetch(`${target.host}${CONTROL_PATH_PREFIX}/status`, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new AgentCanvasControlError(
      response.status,
      `HTTP ${response.status}`,
      response.status === 404,
    );
  }
  // A stack without the route serves the SPA shell for any path.
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new AgentCanvasControlError(
      response.status,
      "The stack has no control routes.",
      true,
    );
  }
  const body = (await response.json()) as Partial<AgentCanvasControlStatus>;
  if (typeof body.instance !== "string") {
    throw new AgentCanvasControlError(
      response.status,
      "The stack has no control routes.",
      true,
    );
  }
  return body as AgentCanvasControlStatus;
}
