export interface GitSyncStatus {
  enabled: boolean;
  repo_url: string;
  branch: string;
  path: string;
  encryption_enabled: boolean;
  /** Seconds between automatic syncs; 0 means manual-only. */
  interval_seconds: number;
  last_synced_commit: string | null;
  last_synced_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  dirty_count: number;
  /**
   * Whether a sync cycle is running right now, including one the backend's own
   * interval started. A cycle reports its outcome only once it ends, so
   * without this the page cannot tell a sync in flight from one that never
   * started. Absent on automation backends that predate the field.
   */
  sync_in_progress?: boolean;
  sync_started_at?: string | null;
}

export interface GitSyncConfigUpdateRequest {
  enabled?: boolean | null;
  interval_seconds?: number | null;
  repo_url?: string | null;
  branch?: string | null;
  path?: string | null;
  token?: string | null;
  encryption_key?: string | null;
  author_name?: string | null;
  author_email?: string | null;
}

export interface GitSyncTriggerResponse {
  triggered: boolean;
}

/**
 * Whether a configuration can reach its repo, from `POST /v1/git-sync/check`.
 *
 * `ok` is about reachability only -- the backend runs a single `git ls-remote`
 * rather than a sync, so a token without write scope passes here and still
 * fails at push time, and the encryption key is never exercised.
 * `branch_exists: false` alongside `ok: true` is normal for a repo that has
 * never been synced: the first cycle creates the branch.
 */
export interface GitSyncCheckResponse {
  ok: boolean;
  branch_exists: boolean;
  /** git's own failure output, with credentials in the URL redacted. */
  detail: string | null;
}

/**
 * One of an organization's git sync remotes: a repository, branch and path
 * with its own configuration and status, from `GET /v1/git-sync/remotes`.
 */
export interface GitSyncRemoteStatus extends GitSyncStatus {
  id: string;
  /** Operator-chosen display name; blank means "show the repository". */
  label: string;
  /**
   * Where automations not assigned to any remote go. Exactly one remote per
   * organization is the default; an organization without one leaves them
   * unsynced.
   */
  is_default: boolean;
  /**
   * Live automations this remote exports: the ones assigned to it, plus --
   * for the default -- the unassigned ones it adopts on its next cycle.
   */
  automation_count: number;
}

export interface GitSyncRemotesResponse {
  remotes: GitSyncRemoteStatus[];
  /** Live automations assigned to no remote yet. */
  unassigned_count: number;
}

export interface GitSyncRemoteUpdateRequest extends GitSyncConfigUpdateRequest {
  label?: string | null;
  /** `true` makes it the default; `false` is refused by the backend. */
  is_default?: boolean | null;
}

export interface GitSyncRemoteCreateRequest extends GitSyncRemoteUpdateRequest {
  repo_url: string;
}

/** Which remote one of the organization's live automations syncs to. */
export interface GitSyncAssignment {
  automation_id: string;
  name: string;
  /** The remote it is assigned to; `null` means none yet. */
  remote_id: string | null;
  /**
   * The remote whose next cycle exports it: the assignment, else the default
   * remote, else `null` (it is synced nowhere).
   */
  effective_remote_id: string | null;
  /** Its directory name under the remote's path, once it has been synced. */
  slug: string | null;
  dirty: boolean;
}

export interface GitSyncAssignmentsResponse {
  automations: GitSyncAssignment[];
}
