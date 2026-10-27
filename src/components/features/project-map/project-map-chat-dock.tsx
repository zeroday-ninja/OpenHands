/**
 * Chat, demoted.
 *
 * The canvas is the work; chat is a thing you open when you want it. So the
 * conversation pane moves out of the rail and into a strip in the corner that
 * expands over the drawing, and the transcript is loaded only when it is
 * opened — it pulls the message renderer, the event helpers and the scroll
 * provider behind it, which is the largest thing on this route that most
 * visits never need.
 *
 * The dock opens itself when a conversation starts from this page. Watching
 * the drawing change with no idea why is worse than a panel appearing. A
 * conversation the page merely remembers from an earlier visit does not open
 * it: that covered the map with a transcript on every return, which is the
 * opposite of a canvas that takes the width.
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import type { PlacedProjectMapDocument } from "#/types/project-map";
import { LoadingSpinner } from "#/components/shared/loading-spinner";
import { useProjectMapStore } from "#/stores/project-map-store";

const ProjectMapConversation = React.lazy(() =>
  import("./project-map-conversation").then((module) => ({
    default: module.ProjectMapConversation,
  })),
);

export interface ProjectMapChatDockProps {
  document: PlacedProjectMapDocument;
  mapPath: string;
  conversationId: string | null;
  launchWorkingDir: string | null;
  onConversationStarted: (id: string) => void;
  onDetach: () => void;
  /**
   * Anything else that belongs in this corner, stacked above the toggle.
   *
   * The dock owns the bottom-right of the paper. A second control placed
   * there independently is drawn on top of this one — which is what the work
   * layer's export did, with "Open chat" sitting across the word "Export".
   */
  aside?: React.ReactNode;
}

export function ProjectMapChatDock({
  document: map,
  mapPath,
  conversationId,
  launchWorkingDir,
  onConversationStarted,
  onDetach,
  aside,
}: ProjectMapChatDockProps) {
  const { t } = useTranslation("openhands");
  const chatOpen = useProjectMapStore((state) => state.chatOpen);
  const setChatOpen = useProjectMapStore((state) => state.setChatOpen);

  // A conversation appearing means work started, and work the user cannot see
  // is work they have to guess at. Appearing: the binding changing under a
  // mounted page, not a page mounting already bound.
  const previous = React.useRef<string | null | undefined>(undefined);
  React.useEffect(() => {
    const before = previous.current;
    previous.current = conversationId;
    if (before === undefined) return;
    if (conversationId !== null && conversationId !== before) setChatOpen(true);
  }, [conversationId, setChatOpen]);

  return (
    <div
      data-testid="project-map-chat-dock"
      data-open={chatOpen ? "true" : "false"}
      className="pointer-events-none absolute bottom-3 right-3 flex max-h-[80%] w-full max-w-md flex-col items-end gap-2"
    >
      {chatOpen && (
        <div className="pointer-events-auto flex max-h-[70vh] w-full flex-col overflow-y-auto rounded-lg border border-border-subtle bg-base-secondary p-3 custom-scrollbar">
          {/* Not nothing: the panel's border is already on the paper, so an
              empty fallback is a bordered box with nothing in it for as long
              as the transcript's chunk takes to arrive — over a second in the
              dev server, and this is the largest import on the route. The
              spinner is the one the app uses everywhere else it waits. */}
          <React.Suspense
            fallback={
              <div className="flex justify-center py-6">
                <LoadingSpinner size="small" />
              </div>
            }
          >
            <ProjectMapConversation
              document={map}
              mapPath={mapPath}
              conversationId={conversationId}
              launchWorkingDir={launchWorkingDir}
              onConversationStarted={onConversationStarted}
              onDetach={onDetach}
            />
          </React.Suspense>
        </div>
      )}
      {aside !== undefined && (
        <div className="pointer-events-auto">{aside}</div>
      )}
      <button
        type="button"
        data-testid="project-map-chat-dock-toggle"
        aria-expanded={chatOpen}
        title={t(I18nKey.PROJECT_MAP$CHAT_PLACEHOLDER)}
        className="pointer-events-auto rounded-md border border-border-subtle bg-base-secondary px-3 py-1.5 text-micro text-muted hover:text-content"
        onClick={() => setChatOpen(!chatOpen)}
      >
        {t(
          chatOpen
            ? I18nKey.PROJECT_MAP$CHAT_DOCK_CLOSE
            : I18nKey.PROJECT_MAP$CHAT_DOCK_OPEN,
        )}
      </button>
    </div>
  );
}
