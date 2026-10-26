/**
 * From a transcript to where the work sits.
 *
 * Clicking an agent on the map's work layer opens its transcript; until this
 * there was no way back. A conversation is one agent's account of what it
 * did, and the map is where that work sits among every other run, cycle and
 * repository — which is the question a reader of a transcript asks next.
 */

import { Map as MapIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import { cn } from "#/utils/utils";
import { mobileTopBarIconButtonClassName } from "#/utils/mobile-top-bar-icon-button-classes";
import { useNavigation } from "#/context/navigation-context";
import { useOptionalConversationId } from "#/hooks/use-conversation-id";
import { ChatActionTooltip } from "../chat/chat-action-tooltip";

export function ConversationOnTheMapLink({
  className,
}: {
  className?: string;
}) {
  const { t } = useTranslation("openhands");
  const { navigate } = useNavigation();
  const { conversationId } = useOptionalConversationId();
  if (!conversationId) return null;
  const label = t(I18nKey.CONVERSATION$ON_THE_MAP);

  return (
    <ChatActionTooltip tooltip={label} ariaLabel={label}>
      <button
        type="button"
        onClick={() =>
          navigate?.(
            `/map?layer=work&conversation=${encodeURIComponent(conversationId)}`,
          )
        }
        className={cn(mobileTopBarIconButtonClassName, "size-7", className)}
        aria-label={label}
        data-testid="conversation-on-the-map"
      >
        <MapIcon className="h-4 w-4 shrink-0" size={16} aria-hidden />
      </button>
    </ChatActionTooltip>
  );
}
