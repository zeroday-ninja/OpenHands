/**
 * Reading and writing `.openhands/workbench.json` in a workspace.
 *
 * The same two typed-client file routes the project map uses, aimed by the
 * same path resolution (`resolveProjectMapPath` already answers "which
 * workspace, which directory"), so the two documents always live next to each
 * other in the same repository. Nothing here is a new endpoint.
 *
 * Scope follows the project map: a local backend with a host workspace or a
 * bound conversation. Cloud is reported as unsupported for the same reasons
 * `ProjectMapService` gives, and a missing file is a normal state, not an
 * error — it is what the empty workbench exists for.
 */

import { FileClient } from "@openhands/typescript-client/clients";
import { getAgentServerClientOptions } from "#/api/agent-server-client-options";
import { isSdkHttpStatusError } from "#/api/agent-server-compatibility";
import {
  ProjectMapReadError,
  ProjectMapRuntimeUnavailableError,
  resolveProjectMapPath,
  type ProjectMapTarget,
  type ProjectMapWorkspace,
} from "#/api/project-map-service/project-map-service.api";
import { PROJECT_MAP_FILE_PATH } from "#/types/project-map";
import { WORKBENCH_FILE_PATH } from "#/types/workbench";

export {
  isProjectMapUnsupportedError as isWorkbenchUnsupportedError,
  projectMapUnsupportedReasonFor as workbenchUnsupportedReasonFor,
  type ProjectMapUnsupportedReason as WorkbenchUnsupportedReason,
} from "#/api/project-map-service/project-map-service.api";

export type WorkbenchWorkspace = ProjectMapWorkspace;

export interface WorkbenchFile {
  workspace: WorkbenchWorkspace;
  absolutePath: string;
  /** Null when there is no workbench document yet. */
  raw: string | null;
}

const RUNTIME_GONE_STATUSES = [410, 502, 503];

function isRuntimeGone(error: unknown) {
  return RUNTIME_GONE_STATUSES.some((status) =>
    isSdkHttpStatusError(error, status),
  );
}

function getClient(conversationId: string | null) {
  return new FileClient(
    getAgentServerClientOptions(
      conversationId === null ? {} : { conversationId },
    ),
  );
}

/** The workbench file sits beside the project map, in the same `.openhands/`. */
export async function resolveWorkbenchPath(target: ProjectMapTarget = {}) {
  const resolved = await resolveProjectMapPath(target);
  return {
    workspace: resolved.workspace,
    absolutePath: resolved.absolutePath.replace(
      PROJECT_MAP_FILE_PATH,
      WORKBENCH_FILE_PATH,
    ),
  };
}

class WorkbenchService {
  static async readWorkbench(
    target: ProjectMapTarget = {},
  ): Promise<WorkbenchFile> {
    const { workspace, absolutePath } = await resolveWorkbenchPath(target);
    const client = getClient(workspace.conversationId);
    try {
      return {
        workspace,
        absolutePath,
        raw: await client.downloadTextFile(absolutePath),
      };
    } catch (error) {
      if (workspace.conversationId !== null && isRuntimeGone(error)) {
        throw new ProjectMapRuntimeUnavailableError(
          workspace.conversationId,
          error,
        );
      }
      if (isSdkHttpStatusError(error, 404))
        return { workspace, absolutePath, raw: null };
      throw new ProjectMapReadError(absolutePath, error);
    } finally {
      client.close();
    }
  }

  /**
   * Replace the document. Unlike the project map this may create the file:
   * the workbench is where a project starts, so there is no agent-written
   * first version to wait for.
   */
  static async writeWorkbench(
    raw: string,
    target: ProjectMapTarget = {},
  ): Promise<string> {
    const { workspace, absolutePath } = await resolveWorkbenchPath(target);
    const client = getClient(workspace.conversationId);
    try {
      await client.uploadTextFile(raw, absolutePath);
      return absolutePath;
    } finally {
      client.close();
    }
  }
}

export default WorkbenchService;
