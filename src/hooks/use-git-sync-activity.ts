import { useEffect, useState } from "react";
import type { GitSyncStatus } from "#/types/git-sync";
import type { GitSyncActivityState } from "#/components/features/automations/git-sync/git-sync-activity-row";

// How long to keep following a cycle we triggered but have never seen the
// backend report as running -- the fallback for an automation backend that
// predates `sync_in_progress`.
const POLL_WINDOW_MS = 30_000;

type SyncActivity =
  | { state: "idle" | "succeeded" | "failed" }
  | {
      state: "running";
      startedAt: string;
      // What the last outcome was when this cycle began: the cycle has landed
      // once the backend reports a newer success or failure than these.
      lastSyncedAt: string | null;
      lastErrorAt: string | null;
    };

const runningSince = (status: GitSyncStatus): SyncActivity => ({
  state: "running",
  startedAt: status.sync_started_at ?? new Date().toISOString(),
  lastSyncedAt: status.last_synced_at,
  lastErrorAt: status.last_error_at,
});

export interface GitSyncActivity {
  state: GitSyncActivityState;
  isRunning: boolean;
  /** When the running cycle started, for the elapsed-time hint. */
  startedAt: string | null;
  /** Follow a cycle this page just triggered through to its outcome. */
  markRunning: () => void;
}

/**
 * The page's own account of one remote's sync cycle, derived from its polled
 * status: a cycle is "running" from the moment it is triggered (or first seen
 * in flight) until the backend reports an outcome newer than the one it
 * started from, which releases the row as soon as the sync really ends
 * rather than at the end of a fixed window.
 */
export function useGitSyncActivity(
  status: GitSyncStatus | undefined,
): GitSyncActivity {
  const [activity, setActivity] = useState<SyncActivity>({ state: "idle" });
  const isRunning = activity.state === "running";

  // Follow a cycle this page did not trigger -- the periodic loop's, or
  // another operator's -- so it shows up here too.
  useEffect(() => {
    if (!status?.sync_in_progress) return;
    setActivity((current) =>
      current.state === "running" ? current : runningSince(status),
    );
  }, [status]);

  useEffect(() => {
    if (activity.state !== "running" || !status) return;
    if (status.last_error_at && status.last_error_at !== activity.lastErrorAt) {
      setActivity({ state: "failed" });
    } else if (
      status.last_synced_at &&
      status.last_synced_at !== activity.lastSyncedAt
    ) {
      setActivity({ state: "succeeded" });
    }
  }, [status, activity]);

  // Give up on a cycle we never saw the backend confirm. A backend that does
  // report `sync_in_progress` immediately re-enters the running state above,
  // so this only bounds the blind case.
  useEffect(() => {
    if (!isRunning) return undefined;
    const timer = setTimeout(
      () => setActivity({ state: "idle" }),
      POLL_WINDOW_MS,
    );
    return () => clearTimeout(timer);
  }, [isRunning, activity]);

  return {
    state: activity.state,
    isRunning,
    startedAt: activity.state === "running" ? activity.startedAt : null,
    markRunning: () => {
      if (status) setActivity(runningSince(status));
    },
  };
}
