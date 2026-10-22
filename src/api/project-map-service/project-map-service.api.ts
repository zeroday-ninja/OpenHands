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
import type { AppConversation } from "#/api/conversation-service/agent-server-conversation-service.types";
import {
  resolveAbsoluteWorkspacePath,
  resolveConversationUploadWorkingDir,
} from "#/api/workspace-upload-path";
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

/** Where the map is, and what is in it. `raw` is null when the file is absent. */
export interface ProjectMapFile {
  /** Absolute path on the agent server, shown to the user so it is no mystery. */
  absolutePath: string;
  raw: string | null;
}

export interface ProjectMapTarget {
  /** The conversation whose workspace holds the map, when there is one. */
  conversationId?: string | null;
  conversation?: AppConversation | null;
}

/**
 * The absolute path of the map file.
 *
 * With a conversation, its own working directory wins, so the map belongs to
 * the repository you are actually working in. Without one — the `/map` page
 * opened straight from the sidebar — the backend's configured working
 * directory is the only sensible answer, and is the same directory a new
 * conversation would get.
 */
export async function resolveProjectMapPath(
  target: ProjectMapTarget = {},
): Promise<string> {
  const workingDir = target.conversationId
    ? await resolveConversationUploadWorkingDir(
        target.conversationId,
        target.conversation ?? null,
      )
    : getAgentServerWorkingDir();
  const absoluteDir = await resolveAbsoluteWorkspacePath(workingDir);
  return `${absoluteDir.replace(/[/\\]+$/, "")}/${PROJECT_MAP_FILE_PATH}`;
}

function getClient(): FileClient {
  return new FileClient(getAgentServerClientOptions());
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
    const absolutePath = await resolveProjectMapPath(target);
    const client = getClient();
    try {
      return { absolutePath, raw: await client.downloadTextFile(absolutePath) };
    } catch (error) {
      if (isSdkHttpStatusError(error, 404)) return { absolutePath, raw: null };
      throw error;
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
    const absolutePath = await resolveProjectMapPath(target);
    const client = getClient();
    try {
      await client.uploadTextFile(raw, absolutePath);
      return absolutePath;
    } finally {
      client.close();
    }
  }
}

export default ProjectMapService;
