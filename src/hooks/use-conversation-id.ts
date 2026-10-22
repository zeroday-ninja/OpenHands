import { useNavigation } from "#/context/navigation-context";
import { useScopedConversationId } from "#/context/scoped-conversation-id-context";

/**
 * The conversation the calling component belongs to, if any.
 *
 * A scoped override wins when one is mounted — see
 * `scoped-conversation-id-context.tsx` — so a page that owns a conversation the
 * URL does not name can bind the conversation hooks to it. With no override,
 * which is every route today, the answer comes from the route exactly as it
 * always has.
 */
export function useOptionalConversationId() {
  const scopedConversationId = useScopedConversationId();
  const { conversationId } = useNavigation();

  return { conversationId: scopedConversationId ?? conversationId };
}

export function useConversationId() {
  const { conversationId } = useOptionalConversationId();

  if (!conversationId) {
    throw new Error(
      "useConversationId must be used within a route that has a conversationId parameter",
    );
  }

  return { conversationId };
}
