import { useQuery } from "@tanstack/react-query";
import { fetchAgentCanvasControl } from "#/api/agent-server-adapter";
import { useActiveBackend } from "#/contexts/active-backend-context";
import { APP_UPDATE_QUERY_KEYS } from "./query-keys";

/**
 * Whether the stack serving this page can update and restart itself on
 * request (a local launcher's ingress advertises it on `/server_info`), and
 * where to send the request. `data` is null everywhere else: Cloud, Docker,
 * a remote Agent Server, `--public`, or an older launcher.
 */
export function useAgentCanvasControl({
  enabled = true,
}: { enabled?: boolean } = {}) {
  const { backend } = useActiveBackend();
  const isLocal = backend.kind === "local";
  return useQuery({
    queryKey: APP_UPDATE_QUERY_KEYS.control(backend.id ?? null),
    queryFn: fetchAgentCanvasControl,
    enabled: enabled && isLocal,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 1000 * 60 * 5,
    meta: { disableToast: true },
  });
}
