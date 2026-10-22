/**
 * The conversation pane beside the canvas.
 *
 * This is the piece that makes the map a place you can work rather than a
 * place you leave: sending binds a real conversation to the pane, and the
 * answer arrives here, next to the drawing it is about. Before anything is
 * sent there is nothing to bind, so the pane is just the composer — the state
 * the page has always had.
 *
 * The binding itself belongs to `ProjectMapPage`, which owns it because it is
 * also the workspace the map is read from: under Docker sandboxes the file
 * lives inside this conversation's container and nowhere else. This pane is
 * given the id and reports a new one; it mounts no transport of its own, since
 * the page already holds the socket open around the whole route.
 */

import { useTranslation } from "react-i18next";
import { Maximize2, MessageSquarePlus } from "lucide-react";
import { I18nKey } from "#/i18n/declaration";
import { useNavigation } from "#/context/navigation-context";
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
  /** The conversation the page is bound to, or null when there is none. */
  conversationId: string | null;
  /** Passed through to the composer: see `ProjectMapChatProps`. */
  launchWorkingDir: string | null;
  /** Reports the conversation a first send just opened. */
  onConversationStarted: (conversationId: string) => void;
  /** Lets go of the bound conversation, which also releases its workspace. */
  onDetach: () => void;
}

export function ProjectMapConversation({
  document: map,
  mapPath,
  conversationId,
  launchWorkingDir,
  onConversationStarted,
  onDetach,
}: ProjectMapConversationProps) {
  const { t } = useTranslation("openhands");
  const { navigate } = useNavigation();

  return (
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
              onClick={onDetach}
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
        launchWorkingDir={launchWorkingDir}
        onConversationStarted={onConversationStarted}
      />
    </section>
  );
}
