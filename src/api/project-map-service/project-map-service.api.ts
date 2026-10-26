/**
 * Reading and writing `.openhands/project-map.json` in a workspace.
 *
 * The map is a file in the repository, so there is no new endpoint here: both
 * directions go through the typed client's existing file routes, the same ones
 * chat attachments already use.
 *
 * - read: `FileClient.downloadTextFile` → `GET /api/file/download`
 * - write: `FileClient.uploadTextFile` → `POST /api/file/upload`
 *
 * Both legs resolve the same absolute path from the same working directory, by
 * the same helper (`resolveAbsoluteWorkspacePath`, spec `WUP-001`). That
 * symmetry is deliberate: the Files drawer reads text through the workspace
 * fileserver URL instead, and mixing the two anchoring schemes is the obvious
 * way to end up writing somewhere you are not reading from.
 *
 * **Which filesystem.** With a conversation, both legs are built with that
 * conversation's id, so the typed client sends them to its runtime —
 * `/api/conversations/{id}/file/{download,upload}` — rather than to the agent
 * server's own host. That is the whole difference between working and not
 * working under `OH_CONVERSATION_RUNTIME=docker`: the repository is cloned
 * inside the conversation's container, where a host-level `/api/file/download`
 * cannot see it, so a host-anchored read answers 404 and the page draws an
 * empty map of a workspace nobody is looking at. The same routes also pin the
 * directory: the agent server rejects a path outside the conversation's own
 * working dir with 422, which is why the path leg below resolves that dir and
 * not the backend's.
 *
 * Scope: a local backend. A Cloud conversation's workspace lives in a
 * per-conversation runtime sandbox, which needs that conversation's own URL
 * and session key before any file call can be made, and is unreachable while
 * the sandbox is paused or still starting. Rather than half-support that, the
 * page reports Cloud as unsupported — the same shape `SoulService` uses — and
 * the agent remains able to edit the file from inside the conversation.
 */

import { FileClient } from "@openhands/typescript-client/clients";
import { getAgentServerWorkingDir } from "#/api/agent-server-config";
import { getAgentServerClientOptions } from "#/api/agent-server-client-options";
import { isSdkHttpStatusError } from "#/api/agent-server-compatibility";
import { isNoBackend } from "#/api/backend-registry/active-store";
import type { Backend } from "#/api/backend-registry/types";
import AgentServerConversationService from "#/api/conversation-service/agent-server-conversation-service.api";
import type { AppConversation } from "#/api/conversation-service/agent-server-conversation-service.types";
import { resolveAbsoluteWorkspacePath } from "#/api/workspace-upload-path";
import { PROJECT_MAP_FILE_PATH } from "#/types/project-map";

/** Why a backend cannot serve the project map. */
export type ProjectMapUnsupportedReason = "no-backend" | "cloud-backend";

export class ProjectMapUnsupportedError extends Error {
  readonly reason: ProjectMapUnsupportedReason;

  constructor(reason: ProjectMapUnsupportedReason) {
    super(`The project map is unavailable on this backend: ${reason}`);
    this.name = "ProjectMapUnsupportedError";
    this.reason = reason;
  }
}

/**
 * Recognized across a serialization boundary, because React Query caches the
 * error object and a rebuilt instance loses `instanceof`.
 */
export function isProjectMapUnsupportedError(
  error: unknown,
): error is ProjectMapUnsupportedError {
  return (
    error instanceof ProjectMapUnsupportedError ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      error.name === "ProjectMapUnsupportedError")
  );
}

/**
 * A read that failed for a reason other than the file being absent, carrying
 * the path it tried.
 *
 * The page's complaint names that path, and it is the one thing the page
 * cannot work out for itself: a failed query has no data to read it from, and
 * resolving it is an async call against the agent server's home directory.
 */
export class ProjectMapReadError extends Error {
  readonly absolutePath: string;

  constructor(absolutePath: string, cause: unknown) {
    super(`The project map at ${absolutePath} could not be read`, { cause });
    this.name = "ProjectMapReadError";
    this.absolutePath = absolutePath;
  }
}

/**
 * The path a failed read tried, or null when it failed before resolving one —
 * which is what a backend whose home directory is unreachable looks like.
 *
 * Read through a property check rather than `instanceof`, for the same reason
 * {@link isProjectMapUnsupportedError} is: React Query hands back the cached
 * error object, and a rebuilt instance loses its prototype.
 */
export function projectMapReadErrorPath(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  if (!("absolutePath" in error)) return null;
  const { absolutePath } = error as { absolutePath: unknown };
  return typeof absolutePath === "string" && absolutePath !== ""
    ? absolutePath
    : null;
}

/**
 * A conversation that cannot serve its workspace any more.
 *
 * A sandbox is not permanent: its container can be archived, fail to start, or
 * belong to a conversation that has since been deleted. None of those is "the
 * repository has no map", and rendering the empty state for them is exactly
 * the silently-wrong-workspace failure this module exists to avoid.
 */
export class ProjectMapRuntimeUnavailableError extends Error {
  readonly conversationId: string;

  constructor(conversationId: string, cause?: unknown) {
    super(
      `The workspace of conversation ${conversationId} cannot be reached`,
      cause === undefined ? undefined : { cause },
    );
    this.name = "ProjectMapRuntimeUnavailableError";
    this.conversationId = conversationId;
  }
}

/**
 * The conversation whose runtime a failed read could not reach, or null when
 * the failure was something else.
 *
 * A property check rather than `instanceof`, for the same reason
 * {@link isProjectMapUnsupportedError} is one: React Query hands back the
 * cached error object and a rebuilt instance has lost its prototype.
 */
export function projectMapUnavailableRuntimeConversation(
  error: unknown,
): string | null {
  if (typeof error !== "object" || error === null) return null;
  if (!("name" in error) || !("conversationId" in error)) return null;
  const { name, conversationId } = error as {
    name: unknown;
    conversationId: unknown;
  };
  if (name !== "ProjectMapRuntimeUnavailableError") return null;
  return typeof conversationId === "string" && conversationId !== ""
    ? conversationId
    : null;
}

/**
 * Pure, so the page can decide from the backend it is rendering without
 * waiting for a request.
 */
export function projectMapUnsupportedReasonFor(
  backend: Backend,
): ProjectMapUnsupportedReason | null {
  if (isNoBackend(backend)) return "no-backend";
  if (backend.kind === "cloud") return "cloud-backend";
  return null;
}

/**
 * The workspace a read or write was aimed at, so the page can name it.
 *
 * Naming it is not decoration. A map read from the wrong filesystem looks
 * exactly like a repository that has no map, and "the project map doesn't
 * work" is what that looks like from the outside. With the directory on
 * screen, an empty map is at least an empty map of somewhere the user
 * recognises.
 */
export interface ProjectMapWorkspace {
  /** The conversation whose runtime serves it, or null for the backend host. */
  conversationId: string | null;
  /** Absolute directory the map file sits in, on that filesystem. */
  workingDir: string;
}

/** Where the map is, and what is in it. `raw` is null when the file is absent. */
export interface ProjectMapFile {
  workspace: ProjectMapWorkspace;
  /** Absolute path on the agent server, shown to the user so it is no mystery. */
  absolutePath: string;
  raw: string | null;
}

export interface ProjectMapTarget {
  /** The conversation whose workspace holds the map, when there is one. */
  conversationId?: string | null;
  conversation?: AppConversation | null;
  /**
   * A folder on the backend's host the page was pointed at. It wins over the
   * conversation: the map is read from the agent server's own filesystem
   * whatever conversation is bound, because a sandbox mounted on this folder
   * writes the very same file, and a sandbox that is gone cannot be asked for
   * it. That is what lets a map outlive the conversation that drew it.
   */
  workingDir?: string | null;
}

/** A resolved target: the workspace, and the file inside it. */
export interface ResolvedProjectMapPath {
  workspace: ProjectMapWorkspace;
  absolutePath: string;
}

/**
 * The conversation's own working directory, or a refusal.
 *
 * Deliberately not {@link resolveConversationUploadWorkingDir}: that helper
 * falls back to the backend's working directory for a conversation it cannot
 * find, which is right for an upload (the file has to land somewhere) and
 * wrong here. Falling back would answer a question about one workspace with a
 * file from another, which is the bug — so a conversation the server does not
 * describe is reported as unreachable instead.
 */
async function resolveConversationWorkspaceDir(
  conversationId: string,
  conversation: AppConversation | null,
): Promise<string> {
  const known =
    conversation?.id === conversationId
      ? conversation.workspace?.working_dir?.trim()
      : undefined;
  if (known) return known;

  const [found] = await AgentServerConversationService.batchGetAppConversations(
    [conversationId],
  );
  const workingDir = found?.workspace?.working_dir?.trim();
  if (!workingDir) throw new ProjectMapRuntimeUnavailableError(conversationId);
  return workingDir;
}

/**
 * The workspace the map belongs to, and the absolute path of the file in it.
 *
 * A chosen folder comes first: the user said which repository this is a map
 * of, and the file is read from that folder on the host however the agent
 * reaches it. Otherwise, with a conversation, its own working directory wins,
 * so the map belongs to the repository you are actually working in — under
 * Docker sandboxes that is the only directory that holds one, and under host
 * workspaces it is the folder the conversation was attached to. Without
 * either — the `/map` page opened straight from the sidebar — the backend's
 * configured working directory is the only sensible answer.
 */
export async function resolveProjectMapPath(
  target: ProjectMapTarget = {},
): Promise<ResolvedProjectMapPath> {
  const chosenDir = target.workingDir?.trim() || null;
  const conversationId =
    chosenDir === null ? target.conversationId || null : null;
  const workingDir =
    chosenDir ??
    (conversationId === null
      ? getAgentServerWorkingDir()
      : await resolveConversationWorkspaceDir(
          conversationId,
          target.conversation ?? null,
        ));
  // A relative working dir is anchored on the agent server's home directory
  // (spec WUP-001). Only host workspaces are ever relative; an isolated
  // sandbox reports an absolute dir, which passes through untouched.
  const absoluteDir = (await resolveAbsoluteWorkspacePath(workingDir)).replace(
    /[/\\]+$/,
    "",
  );
  return {
    workspace: { conversationId, workingDir: absoluteDir },
    absolutePath: `${absoluteDir}/${PROJECT_MAP_FILE_PATH}`,
  };
}

/**
 * Statuses that mean the conversation's runtime cannot serve files, as opposed
 * to the file being absent from a runtime that can.
 *
 * The agent server answers 410 for a conversation whose runtime was archived
 * ("its history is read-only") and 502 when the container cannot be started;
 * 503 is the Docker runtime being unavailable altogether.
 */
const RUNTIME_GONE_STATUSES = [410, 502, 503];

function isRuntimeGone(error: unknown): boolean {
  return RUNTIME_GONE_STATUSES.some((status) =>
    isSdkHttpStatusError(error, status),
  );
}

/**
 * A file client aimed at one workspace.
 *
 * Passing the conversation id is what moves the request off the agent server's
 * own filesystem and onto that conversation's runtime; omitting it is the
 * host-level read the sidebar's own `/map` does.
 */
function getClient(conversationId: string | null): FileClient {
  return new FileClient(
    getAgentServerClientOptions(
      conversationId === null ? {} : { conversationId },
    ),
  );
}

class ProjectMapService {
  /**
   * The document as it is on disk. A missing file is a normal state — it is
   * what the page's empty state exists for — so a 404 reads as `raw: null`
   * rather than an error.
   */
  static async readProjectMap(
    target: ProjectMapTarget = {},
  ): Promise<ProjectMapFile> {
    const { workspace, absolutePath } = await resolveProjectMapPath(target);
    const client = getClient(workspace.conversationId);
    try {
      return {
        workspace,
        absolutePath,
        raw: await client.downloadTextFile(absolutePath),
      };
    } catch (error) {
      // A 404 here is the file, not the workspace: a conversation target has
      // already been described by the server a moment ago, so its runtime
      // exists. The statuses that mean otherwise are checked first.
      if (workspace.conversationId !== null && isRuntimeGone(error)) {
        throw new ProjectMapRuntimeUnavailableError(
          workspace.conversationId,
          error,
        );
      }
      if (isSdkHttpStatusError(error, 404)) {
        return { workspace, absolutePath, raw: null };
      }
      throw new ProjectMapReadError(absolutePath, error);
    } finally {
      client.close();
    }
  }

  /**
   * Replace the document.
   *
   * The page only ever saves a document it already read, which is what keeps
   * this from having to create `.openhands/` itself: the directory exists
   * because the file in it does. Generating the very first map is the agent's
   * job, from inside a conversation that can run commands.
   */
  static async writeProjectMap(
    raw: string,
    target: ProjectMapTarget = {},
  ): Promise<string> {
    const { workspace, absolutePath } = await resolveProjectMapPath(target);
    const client = getClient(workspace.conversationId);
    try {
      await client.uploadTextFile(raw, absolutePath);
      return absolutePath;
    } finally {
      client.close();
    }
  }
}

export default ProjectMapService;
