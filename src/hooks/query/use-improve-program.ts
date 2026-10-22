import { useQuery } from "@tanstack/react-query";
import AutomationService from "#/api/automation-service/automation-service.api";
import { useActiveBackend } from "#/contexts/active-backend-context";
import { getErrorStatus } from "#/hooks/query/use-settings";
import { IMPROVE_QUERY_KEYS } from "#/hooks/query/query-keys";
import {
  TERMINAL_IMPROVE_CYCLE_STATUSES,
  type ImproveCycleListResponse,
} from "#/types/improve";

/** How closely the history is polled while a cycle is still in flight. */
export const IMPROVE_CYCLE_POLL_INTERVAL_MS = 5000;

const DEFAULT_CYCLE_PAGE_SIZE = 20;

interface UseImproveProgramOptions {
  automationId: string;
  enabled?: boolean;
}

/**
 * A program's rotation: its repositories in order, which one the next run
 * will take, and the previous run's cycle.
 *
 * A 409 means the automation is not an improvement program and a 404 that it
 * does not exist; both answer the same way forever, so neither is retried.
 * The page renders each as a state of its own rather than a toast.
 */
export function useImproveRotation(options: UseImproveProgramOptions) {
  const { automationId, enabled = true } = options;
  const active = useActiveBackend();

  return useQuery({
    queryKey: IMPROVE_QUERY_KEYS.rotation(
      automationId,
      active.backend.id,
      active.orgId ?? null,
    ),
    queryFn: () => AutomationService.getImproveRotation(automationId),
    staleTime: 10 * 1000,
    enabled: !!automationId && enabled,
    retry: (failureCount, error) =>
      getErrorStatus(error) === undefined && failureCount < 2,
    meta: { disableToast: true },
  });
}

interface UseImproveCyclesOptions extends UseImproveProgramOptions {
  limit?: number;
  offset?: number;
}

/**
 * A program's cycle history, newest first.
 *
 * Polled while the newest cycle has not reached a terminal status, the way
 * `useAutomationRuns` polls a run: a cycle moves CLAIMED -> BUILDING ->
 * REVIEWING over many minutes, and its reviews, sources and verdict land one
 * stage at a time.
 */
export function useImproveCycles(options: UseImproveCyclesOptions) {
  const {
    automationId,
    enabled = true,
    limit = DEFAULT_CYCLE_PAGE_SIZE,
    offset = 0,
  } = options;
  const active = useActiveBackend();

  return useQuery({
    queryKey: IMPROVE_QUERY_KEYS.cycles(
      automationId,
      { limit, offset },
      active.backend.id,
      active.orgId ?? null,
    ),
    queryFn: () =>
      AutomationService.listImproveCycles(automationId, { limit, offset }),
    staleTime: 10 * 1000,
    enabled: !!automationId && enabled,
    refetchInterval: (query) => {
      const data = query.state.data as ImproveCycleListResponse | undefined;
      const newest = data?.cycles[0];
      if (!newest) return false;
      return TERMINAL_IMPROVE_CYCLE_STATUSES.includes(newest.status)
        ? false
        : IMPROVE_CYCLE_POLL_INTERVAL_MS;
    },
    retry: (failureCount, error) =>
      getErrorStatus(error) === undefined && failureCount < 2,
    meta: { disableToast: true },
  });
}
