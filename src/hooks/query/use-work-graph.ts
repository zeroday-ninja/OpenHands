import React from "react";
import { useQueries } from "@tanstack/react-query";
import AutomationService from "#/api/automation-service/automation-service.api";
import {
  getRegisteredBackends,
  isNoBackend,
  subscribeActiveBackend,
} from "#/api/backend-registry/active-store";
import {
  getHealthSnapshot,
  subscribeBackendHealth,
} from "#/api/backend-registry/health-store";
import type { Backend } from "#/api/backend-registry/types";
import { useActiveBackend } from "#/contexts/active-backend-context";
import { WORK_GRAPH_QUERY_KEYS } from "#/hooks/query/query-keys";
import {
  WORK_GRAPH_BACKEND_NODE_KIND,
  WORK_GRAPH_DEFAULT_LIMIT,
  WORK_GRAPH_DEFAULT_WINDOW_DAYS,
  type WorkGraphResponse,
} from "#/types/work-graph";
import { getApiOrConnectionErrorMessage } from "#/utils/api-error-message";
import { workGraphBackendKey } from "#/utils/work-graph/work-graph-key";
import {
  mergeWorkGraphs,
  type MergedWorkGraph,
  type WorkGraphContribution,
  type WorkGraphContributionState,
} from "#/utils/work-graph/work-graph-merge";

/**
 * How often to re-ask while any deployment reports work in flight.
 *
 * 5s is the cadence of a thing you watch move. It is affordable only because
 * it stops dead when nothing is running: an idle set of deployments costs
 * exactly zero requests, which is the whole reason the service reports
 * `in_flight` at all rather than leaving Canvas to poll on a timer forever.
 */
const IN_FLIGHT_POLL_INTERVAL_MS = 5000;

export interface UseWorkGraphOptions {
  windowDays?: number;
  limit?: number;
  /**
   * Set `false` while the work layer is not on screen. The graph then reports
   * every deployment as `pending` without asking any of them — a hidden layer
   * should cost nothing, and the project map can be in a mode that never draws
   * it.
   */
  enabled?: boolean;
}

export interface UseWorkGraphResult {
  graph: MergedWorkGraph;
  /** What each deployment contributed, which is what an export attests to. */
  contributions: readonly WorkGraphContribution[];
  /** No deployment has answered yet, though at least one was asked. */
  isPending: boolean;
  isFetching: boolean;
}

/**
 * The work graph across every registered deployment.
 *
 * Modelled on `useBackendsHealth`, and holding the same fan-out discipline: one
 * query per backend, keyed so a host or organization change re-keys rather than
 * mixes, no retries, and no toast per failing deployment. Two rules are
 * specific to this view:
 *
 *  - **A backend the health circuit breaker has given up on is never asked**,
 *    but it is still in the graph, as a node with status `unreachable` and an
 *    omission naming it. Silence is not an option here: a deployment missing
 *    from the picture is indistinguishable from a deployment with no work, and
 *    the second is a claim Canvas has no right to make.
 *  - **Polling is a function of the data.** Every 5s while any deployment
 *    reports `in_flight > 0`, and never otherwise.
 *
 * It reads the breaker's verdict from the health store rather than calling
 * `useBackendsHealth`: that hook *probes*, and a background picture of work
 * must not add two requests per backend per tick to find out what the sidebar
 * already knows. The cost is that a stale persisted `disabled` only clears
 * when something else probes — which reads as `unreachable` here, the same
 * thing the rest of the UI is showing.
 */
export function useWorkGraph(
  options: UseWorkGraphOptions = {},
): UseWorkGraphResult {
  const {
    windowDays = WORK_GRAPH_DEFAULT_WINDOW_DAYS,
    limit = WORK_GRAPH_DEFAULT_LIMIT,
    enabled = true,
  } = options;

  // Read from the store rather than the context: the context's list throws
  // outside a provider, which would make any surface that draws work graphs
  // unmountable in an embedded host — and this hook only ever reads.
  const backends = React.useSyncExternalStore(
    subscribeActiveBackend,
    getRegisteredBackends,
    getRegisteredBackends,
  );
  const active = useActiveBackend();
  const healthMap = React.useSyncExternalStore(
    subscribeBackendHealth,
    getHealthSnapshot,
    getHealthSnapshot,
  );

  // The `NO_BACKEND` sentinel has no host to ask and must never be persisted
  // into a key, so it is not part of the fan-out.
  const queryable = React.useMemo(
    () => backends.filter((backend) => !isNoBackend(backend)),
    [backends],
  );

  /**
   * Which deployments were working as of the last render.
   *
   * A query's `refetchInterval` is evaluated for one backend at a time and
   * cannot see its peers, so the fan-out's state is parked here and refreshed
   * below from the merged graph. A ref rather than state because nothing
   * renders from it: it only decides whether a tick is scheduled, and React
   * Query re-evaluates the interval whenever these options change.
   *
   * A backend reads its *own* freshness from its own query data and only
   * consults this for the others, so one deployment finishing its work always
   * stops its own polling on the spot, however stale this is.
   */
  const busyBackendKeys = React.useRef<Set<string>>(new Set());

  // The organization only exists for the backend the user has selected; any
  // other Cloud deployment is asked without one rather than with the wrong one.
  const orgIdFor = (backend: Backend): string | null =>
    backend.id === active.backend.id ? active.orgId : null;

  const results = useQueries({
    queries: queryable.map((backend) => {
      const orgId = orgIdFor(backend);
      const backendKey = workGraphBackendKey(backend, orgId);
      const isCircuitBreakerDisabled = healthMap[backend.id]?.disabled === true;
      return {
        queryKey: WORK_GRAPH_QUERY_KEYS.byBackend(
          backend.id,
          orgId,
          backend.connectionRevision ?? 0,
          { windowDays, limit },
        ),
        queryFn: () =>
          AutomationService.getWorkGraph(backend, orgId, { windowDays, limit }),
        enabled: enabled && !isCircuitBreakerDisabled,
        // A failed deployment settles into its `unreachable` node instead of
        // hammering a service that is already known to be unwell.
        retry: false,
        staleTime: IN_FLIGHT_POLL_INTERVAL_MS,
        // The graph is a background picture; refetching the whole fan-out on
        // every tab focus would cost one request per deployment for a view the
        // user may not even be looking at.
        refetchOnWindowFocus: false,
        // The graph already shows a deployment that is not answering. One
        // error toast per deployment would say the same thing, louder.
        meta: { disableToast: true },
        refetchInterval: (query: { state: { data?: WorkGraphResponse } }) => {
          const peerIsBusy = [...busyBackendKeys.current].some(
            (key) => key !== backendKey,
          );
          const isBusy = (query.state.data?.in_flight ?? 0) > 0;
          return peerIsBusy || isBusy ? IN_FLIGHT_POLL_INTERVAL_MS : false;
        },
      };
    }),
  });

  // One string that changes exactly when the graph could have changed, so the
  // merged graph keeps its identity across unrelated re-renders of the page
  // that draws it.
  const signature = queryable
    .map((backend, index) => {
      const result = results[index];
      return [
        workGraphBackendKey(backend, orgIdFor(backend)),
        backend.name,
        healthMap[backend.id]?.disabled === true ? "disabled" : "",
        result?.dataUpdatedAt ?? 0,
        result?.errorUpdatedAt ?? 0,
      ].join("\u0000");
    })
    .join("\u0001");

  // The contributions, not only the merged result: an export has to say what
  // each deployment contributed — including the ones that could not be asked,
  // because an absent backend and a backend with no work are the same empty
  // space otherwise. Memoised on the same signature so the two cannot drift.
  const { graph, contributions } = React.useMemo(() => {
    const contributions: WorkGraphContribution[] = queryable.map(
      (backend, index) => {
        const result = results[index];
        const healthEntry = healthMap[backend.id];
        const isCircuitBreakerDisabled = healthEntry?.disabled === true;

        let state: WorkGraphContributionState;
        if (isCircuitBreakerDisabled || result?.isError) state = "unreachable";
        else if (result?.data) state = "answered";
        else state = "pending";

        return {
          backendKey: workGraphBackendKey(backend, orgIdFor(backend)),
          backendId: backend.id,
          backendName: backend.name,
          state,
          response: result?.data ?? null,
          // The breaker already recorded why it gave up, so the omission can
          // say so instead of just "unreachable".
          error: isCircuitBreakerDisabled
            ? (healthEntry?.lastError ?? null)
            : getApiOrConnectionErrorMessage(result?.error, "") || null,
        };
      },
    );

    return { graph: mergeWorkGraphs(contributions), contributions };
  }, [signature]);

  // Read back from the merge rather than from the responses: the backend node
  // is `in_flight` exactly when that deployment is both readable and working,
  // so this cannot disagree with what the graph shows.
  busyBackendKeys.current = new Set(
    graph.nodes
      .filter(
        (node) =>
          node.kind === WORK_GRAPH_BACKEND_NODE_KIND &&
          node.status === "in_flight",
      )
      .flatMap((node) => node.backendKeys),
  );

  const askedAnyone =
    enabled &&
    queryable.some((backend) => healthMap[backend.id]?.disabled !== true);

  return {
    graph,
    contributions,
    isPending: askedAnyone && results.every((result) => result.isPending),
    isFetching: results.some((result) => result.isFetching),
  };
}
