/**
 * The conversation pane beside the canvas.
 *
 * This is the piece that makes the map a place you can work rather than a
 * place you leave: sending binds a real conversation to the pane, and the
 * answer arrives here, next to the drawing it is about. Before anything is
 * sent there is nothing to bind, so the pane is just the composer — the state
 * the page has always had.
 *
 * How the plumbing reaches a conversation the URL does not name: every
 * conversation hook resolves its id through `useOptionalConversationId`, which
 * normally answers from the route. `ScopedConversationIdProvider` overrides
 * that for this subtree only, so `WebSocketProviderWrapper` below it opens the
 * socket for the bound conversation, the event store fills, and the shared
 * rendering works unchanged. `/conversations/:conversationId` mounts no such
 * provider and keeps resolving its id from the route exactly as before.
 *
 * Binding is page state rather than store state on purpose. It lasts as long
 * as you are looking at the map and no longer: a conversation id outliving the
 * page would mean coming back later — possibly on another backend, where the
 * id means nothing — to a pane claiming a conversation nobody asked for.
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { Maximize2, MessageSquarePlus } from "lucide-react";
import { I18nKey } from "#/i18n/declaration";
import { useNavigation } from "#/context/navigation-context";
import { ScopedConversationIdProvider } from "#/context/scoped-conversation-id-context";
import { WebSocketProviderWrapper } from "#/contexts/websocket-provider-wrapper";
import { EventHandler } from "#/wrapper/event-handler";
import type { PlacedProjectMapDocument } from "#/types/project-map";
import { ProjectMapChat } from "./project-map-chat";
import { ProjectMapTranscript } from "./project-map-transcript";
import {
  PROJECT_MAP_BUTTON_CLASS,
  PROJECT_MAP_SECTION_LABEL_CLASS,
} from "./project-map-controls";

const ICON_SIZE = 13;

export interface ProjectMapConversationProps {
  document: PlacedProjectMapDocument;
  /** Absolute path of the open map, named in the context block. */
  mapPath: string;
}

export function ProjectMapConversation({
  document: map,
  mapPath,
}: ProjectMapConversationProps) {
  const { t } = useTranslation("openhands");
  const { navigate } = useNavigation();
  const [conversationId, setConversationId] = React.useState<string | null>(
    null,
  );

  const pane = (
    <section
      data-testid="project-map-conversation"
      data-conversation-id={conversationId ?? undefined}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <span className={PROJECT_MAP_SECTION_LABEL_CLASS}>
          {t(I18nKey.PROJECT_MAP$CHAT_TITLE)}
        </span>
        {conversationId !== null && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              data-testid="project-map-open-conversation"
              className={PROJECT_MAP_BUTTON_CLASS}
              onClick={() => navigate(`/conversations/${conversationId}`)}
            >
              <Maximize2 size={ICON_SIZE} aria-hidden />
              {t(I18nKey.PROJECT_MAP$OPEN_CONVERSATION)}
            </button>
            <button
              type="button"
              data-testid="project-map-detach-conversation"
              className={PROJECT_MAP_BUTTON_CLASS}
              onClick={() => setConversationId(null)}
            >
              <MessageSquarePlus size={ICON_SIZE} aria-hidden />
              {t(I18nKey.COMMON$NEW_CONVERSATION)}
            </button>
          </div>
        )}
      </div>

      {conversationId !== null && <ProjectMapTranscript document={map} />}

      <ProjectMapChat
        document={map}
        mapPath={mapPath}
        conversationId={conversationId}
        onConversationStarted={setConversationId}
      />
    </section>
  );

  if (conversationId === null) return pane;

  return (
    <ScopedConversationIdProvider conversationId={conversationId}>
      <WebSocketProviderWrapper conversationId={conversationId}>
        <EventHandler>{pane}</EventHandler>
      </WebSocketProviderWrapper>
    </ScopedConversationIdProvider>
  );
}
