import { MessageSquare } from "lucide-react";
import { buildAgentCanvasPath } from "#/utils/base-path";

interface ImproveConversationLinkProps {
  conversationId: string;
  /** Localized, and the accessible name of the link. */
  label: string;
  testId?: string;
}

/**
 * A link to the conversation an agent did the work in. Built the same way the
 * activity log builds its run links: conversations live at
 * `/conversations/:id`, under the base path when Canvas is mounted on a
 * subpath.
 */
export function ImproveConversationLink({
  conversationId,
  label,
  testId = "improve-conversation-link",
}: ImproveConversationLinkProps) {
  return (
    <a
      data-testid={testId}
      href={buildAgentCanvasPath(`/conversations/${conversationId}`)}
      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
    >
      <MessageSquare className="size-3.5" aria-hidden />
      {label}
    </a>
  );
}
