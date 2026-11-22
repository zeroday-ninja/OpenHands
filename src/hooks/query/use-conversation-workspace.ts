import { useQuery } from "@tanstack/react-query";
import { useActiveBackend } from "#/contexts/active-backend-context";
import {
  getConversationServerInfo,
  usesIsolatedWorkspace,
} from "#/api/conversation-workspace";

/**
 * Whether the active backend runs each conversation in its own container.
 *
 * This used to also hand back an "unsupported" message that disabled every
 * host-folder control on such a backend. The Docker runtime mounts a chosen
 * host folder at `/workspace` inside the sandbox — it has since agent server
 * 1.55 — so a folder attaches there as well as anywhere; what still cannot
 * attach is a repository from a Git provider, which the launch guard refuses
 * with its own message. Callers that hid folders behind the flag now only use
 * it to say that the conversation gets a sandbox.
 */
export function useConversationWorkspace() {
  const { backend } = useActiveBackend();
  const query = useQuery({
    queryKey: [
      "conversation-workspace",
      backend.id,
      backend.host,
      backend.connectionRevision,
    ],
    queryFn: () => getConversationServerInfo(),
    enabled: backend.kind === "local" && !!backend.host,
    staleTime: 60_000,
    retry: false,
    meta: { disableToast: true },
  });
  return {
    isolated: backend.kind === "local" && usesIsolatedWorkspace(query.data),
  };
}
