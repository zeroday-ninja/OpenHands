import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import AutomationService from "#/api/automation-service/automation-service.api";
import { useActiveBackend } from "#/contexts/active-backend-context";
import { getErrorStatus } from "#/hooks/query/use-settings";
import { useTracking } from "#/hooks/use-tracking";
import { GIT_SYNC_QUERY_KEYS } from "#/hooks/query/query-keys";
import type {
  GitSyncConfigUpdateRequest,
  GitSyncRemoteCreateRequest,
  GitSyncRemoteUpdateRequest,
} from "#/types/git-sync";

export const GIT_SYNC_STATUS_QUERY_KEY = ["git-sync-status"] as const;

interface UseGitSyncStatusOptions {
  enabled?: boolean;
  refetchInterval?: number | false;
}

export function useGitSyncStatus(options: UseGitSyncStatusOptions = {}) {
  const { enabled = true, refetchInterval = false } = options;
  const active = useActiveBackend();
  return useQuery({
    queryKey: [...GIT_SYNC_STATUS_QUERY_KEY, active.backend.id, active.orgId],
    queryFn: () => AutomationService.getGitSyncStatus(),
    staleTime: 10 * 1000, // 10 seconds
    enabled,
    refetchInterval,
    // Only a request that never got an answer is worth repeating. A 404 means
    // the backend has no git-sync API and will answer the same forever, and an
    // answered failure has already cost the service's own timeout: a saturated
    // automation service replies 500 after a 30s connection-pool timeout, so
    // three retries plus backoff sat the page in its skeleton for about two
    // minutes before showing the error panel it could have shown at once.
    retry: (failureCount, error) =>
      getErrorStatus(error) === undefined && failureCount < 2,
    // The page turns every failure into a state of its own (unsupported
    // backend, or the error panel with Retry), so the global query toast
    // would only add raw axios text on top of it.
    meta: { disableToast: true },
  });
}

export function useUpdateGitSyncConfig() {
  const queryClient = useQueryClient();
  const active = useActiveBackend();
  const { trackGitSyncConfigUpdated } = useTracking();
  return useMutation({
    mutationFn: (body: GitSyncConfigUpdateRequest) =>
      AutomationService.updateGitSyncConfig(body),
    onSuccess: async (data) => {
      const queryKey = [
        ...GIT_SYNC_STATUS_QUERY_KEY,
        active.backend.id,
        active.orgId,
      ];
      // Cancel first: a status GET that started before this save resolves
      // after it and would overwrite the response we just seeded with its own
      // pre-save snapshot.
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData(queryKey, data);
      trackGitSyncConfigUpdated({ backendKind: active.backend.kind });
    },
    // The form reports failures itself, so the global mutation toast would
    // stack a raw one on top.
    meta: { disableToast: true },
  });
}

/**
 * Test a configuration against its remote before saving it.
 *
 * Deliberately not retried and never surfaced as a toast: the form treats a
 * check it cannot complete -- an older automation backend answering 404,
 * a network failure -- as "no opinion" and saves anyway, so a check that is
 * itself broken can never become the thing that blocks a save.
 */
export function useCheckGitSyncConfig() {
  return useMutation({
    mutationFn: (body: GitSyncConfigUpdateRequest) =>
      AutomationService.checkGitSyncConfig(body),
    retry: false,
    meta: { disableToast: true },
  });
}

export function useTriggerGitSync() {
  const queryClient = useQueryClient();
  const active = useActiveBackend();
  const { trackGitSyncTriggered } = useTracking();
  return useMutation({
    mutationFn: () => AutomationService.triggerGitSync(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: GIT_SYNC_STATUS_QUERY_KEY });
      trackGitSyncTriggered({ backendKind: active.backend.kind });
    },
    // The page maps a failed trigger to its own message (503 means sync is
    // off, not that the request broke), so the global mutation toast would
    // stack a raw one on top.
    meta: { disableToast: true },
  });
}

// --- Remotes: any number of repositories per organization --------------------

interface UseGitSyncRemotesOptions {
  enabled?: boolean;
  refetchInterval?: number | false;
}

/**
 * The organization's git sync remotes. A 404 means the automation backend
 * predates remotes and still has only the single-repo API above; the page
 * falls back to that surface, so the failure is neither retried nor toasted.
 */
export function useGitSyncRemotes(options: UseGitSyncRemotesOptions = {}) {
  const { enabled = true, refetchInterval = false } = options;
  const active = useActiveBackend();
  return useQuery({
    queryKey: [...GIT_SYNC_QUERY_KEYS.remotes, active.backend.id, active.orgId],
    queryFn: () => AutomationService.listGitSyncRemotes(),
    staleTime: 10 * 1000,
    enabled,
    refetchInterval,
    retry: (failureCount, error) =>
      getErrorStatus(error) === undefined && failureCount < 2,
    meta: { disableToast: true },
  });
}

export function useGitSyncAssignments(options: { enabled?: boolean } = {}) {
  const { enabled = true } = options;
  const active = useActiveBackend();
  return useQuery({
    queryKey: [
      ...GIT_SYNC_QUERY_KEYS.assignments,
      active.backend.id,
      active.orgId,
    ],
    queryFn: () => AutomationService.listGitSyncAssignments(),
    staleTime: 10 * 1000,
    enabled,
    retry: (failureCount, error) =>
      getErrorStatus(error) === undefined && failureCount < 2,
    meta: { disableToast: true },
  });
}

/**
 * Drop every cached view of the remotes after a write. The legacy status is
 * the default remote's, so it goes too.
 */
function useInvalidateGitSync() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: GIT_SYNC_QUERY_KEYS.all }),
      queryClient.invalidateQueries({ queryKey: GIT_SYNC_STATUS_QUERY_KEY }),
    ]);
}

export function useCreateGitSyncRemote() {
  const invalidate = useInvalidateGitSync();
  const active = useActiveBackend();
  const { trackGitSyncConfigUpdated } = useTracking();
  return useMutation({
    mutationFn: (body: GitSyncRemoteCreateRequest) =>
      AutomationService.createGitSyncRemote(body),
    onSuccess: async () => {
      await invalidate();
      trackGitSyncConfigUpdated({ backendKind: active.backend.kind });
    },
    // The form reports failures itself (a 409 names the remote that already
    // syncs the repository), so the global toast would only repeat it.
    meta: { disableToast: true },
  });
}

export function useUpdateGitSyncRemote() {
  const invalidate = useInvalidateGitSync();
  const active = useActiveBackend();
  const { trackGitSyncConfigUpdated } = useTracking();
  return useMutation({
    mutationFn: ({
      remoteId,
      body,
    }: {
      remoteId: string;
      body: GitSyncRemoteUpdateRequest;
    }) => AutomationService.updateGitSyncRemote(remoteId, body),
    onSuccess: async () => {
      await invalidate();
      trackGitSyncConfigUpdated({ backendKind: active.backend.kind });
    },
    meta: { disableToast: true },
  });
}

export function useDeleteGitSyncRemote() {
  const invalidate = useInvalidateGitSync();
  return useMutation({
    mutationFn: (remoteId: string) =>
      AutomationService.deleteGitSyncRemote(remoteId),
    onSuccess: () => invalidate(),
    meta: { disableToast: true },
  });
}

/**
 * Test a remote's configuration against its repository before saving it;
 * `remoteId` null is a repository about to be added. Like
 * `useCheckGitSyncConfig`, never retried and never toasted: a check that
 * cannot run must not be what blocks a save.
 */
export function useCheckGitSyncRemote() {
  return useMutation({
    mutationFn: ({
      remoteId,
      body,
    }: {
      remoteId: string | null;
      body: GitSyncConfigUpdateRequest;
    }) => AutomationService.checkGitSyncRemote(remoteId, body),
    retry: false,
    meta: { disableToast: true },
  });
}

export function useTriggerGitSyncRemote() {
  const invalidate = useInvalidateGitSync();
  const active = useActiveBackend();
  const { trackGitSyncTriggered } = useTracking();
  return useMutation({
    mutationFn: (remoteId: string) =>
      AutomationService.triggerGitSyncRemote(remoteId),
    onSuccess: async () => {
      await invalidate();
      trackGitSyncTriggered({ backendKind: active.backend.kind });
    },
    meta: { disableToast: true },
  });
}

export function useAssignGitSyncRemote() {
  const invalidate = useInvalidateGitSync();
  return useMutation({
    mutationFn: ({
      automationId,
      remoteId,
    }: {
      automationId: string;
      remoteId: string;
    }) => AutomationService.assignGitSyncRemote(automationId, remoteId),
    onSuccess: () => invalidate(),
    meta: { disableToast: true },
  });
}
