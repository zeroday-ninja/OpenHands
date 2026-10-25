import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import AutomationService from "#/api/automation-service/automation-service.api";
import { useActiveBackend } from "#/contexts/active-backend-context";
import { getErrorStatus } from "#/hooks/query/use-settings";
import {
  IMPROVE_QUERY_KEYS,
  WORK_GRAPH_QUERY_KEYS,
} from "#/hooks/query/query-keys";
import {
  SELF_ADVANCING_IMPROVE_CYCLE_STATUSES,
  type ImproveCycleListResponse,
  type ImproveCycle,
  type ImproveRoute,
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
      // Polled while something is actually working, rather than until a
      // terminal status: a parked cycle is neither, and waiting for a person
      // is not a reason to ask every five seconds for days.
      return SELF_ADVANCING_IMPROVE_CYCLE_STATUSES.includes(newest.status)
        ? IMPROVE_CYCLE_POLL_INTERVAL_MS
        : false;
    },
    retry: (failureCount, error) =>
      getErrorStatus(error) === undefined && failureCount < 2,
    meta: { disableToast: true },
  });
}

/** How many parked cycles the panel asks for. */
const PARKED_PAGE_SIZE = 20;

/**
 * Everything waiting for a person, across every program on this backend.
 *
 * Not polled. Parked work appears when a cycle decides it needs an answer,
 * which happens at the end of a run that has been going for many minutes —
 * so the cycle history's own polling is what surfaces it, and a second timer
 * here would only add requests. Answering invalidates this.
 */
export function useParkedImproveCycles(enabled = true) {
  const active = useActiveBackend();

  return useQuery({
    queryKey: IMPROVE_QUERY_KEYS.parked(
      active.backend.id,
      active.orgId ?? null,
      PARKED_PAGE_SIZE,
    ),
    queryFn: () => AutomationService.listParkedImproveCycles(PARKED_PAGE_SIZE),
    staleTime: 30 * 1000,
    enabled,
    retry: (failureCount, error) =>
      getErrorStatus(error) === undefined && failureCount < 2,
    // An automations backend from before the gate landed answers 404 here.
    // That is not a problem to put in front of the user: it means this
    // deployment has no parked work because it cannot park anything.
    meta: { disableToast: true },
  });
}

/**
 * Answer what a parked cycle is waiting for.
 *
 * Invalidates every view of every program rather than patching the one cycle.
 * An answered cycle keeps its parked status — it is waiting on a run now
 * rather than on a person, and that is the status the service's janitor
 * leaves alone — so the panel's list loses it for having been *answered*,
 * not for having changed state. The work graph changes too, which is why
 * both are invalidated.
 */
export function useResolveImproveCycle() {
  const queryClient = useQueryClient();

  return useMutation<
    ImproveCycle,
    Error,
    { cycleId: string; route: ImproveRoute; resolution: string }
  >({
    mutationFn: ({ cycleId, route, resolution }) =>
      AutomationService.resolveImproveCycle(cycleId, { route, resolution }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: IMPROVE_QUERY_KEYS.all });
      void queryClient.invalidateQueries({
        queryKey: WORK_GRAPH_QUERY_KEYS.all,
      });
    },
  });
}
