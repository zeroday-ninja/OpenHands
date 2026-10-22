/**
 * A conversation id handed to a subtree, for a page that hosts a conversation
 * without being a conversation route.
 *
 * `useOptionalConversationId` normally answers from the route, which is right
 * for `/conversations/:conversationId` and is why every conversation hook can
 * be written without passing an id around. But a page can legitimately own a
 * conversation that the URL does not name — `/map` keeps one beside the canvas
 * — and such a page has nothing for the route-based answer to come from.
 *
 * This is deliberately an *override*, not a replacement: the provider is only
 * mounted around the subtree that owns the conversation, and
 * `useOptionalConversationId` falls back to the route everywhere else. The
 * conversation route therefore keeps resolving its id exactly as before, and a
 * component that renders both inside a pane and on a conversation route cannot
 * pick up the wrong id, because React context only reaches the subtree the
 * provider wraps.
 *
 * The provider takes a non-optional `string` on purpose. "Override the route
 * with nothing" is not a state anyone wants — it would blank out a conversation
 * route's own id — so a caller with no conversation yet simply does not mount
 * the provider.
 */

import React from "react";

/** Null means "no override": ask the route, as every other page does. */
const ScopedConversationIdContext = React.createContext<string | null>(null);

interface ScopedConversationIdProviderProps {
  conversationId: string;
  children: React.ReactNode;
}

export function ScopedConversationIdProvider({
  conversationId,
  children,
}: ScopedConversationIdProviderProps) {
  return (
    <ScopedConversationIdContext.Provider value={conversationId}>
      {children}
    </ScopedConversationIdContext.Provider>
  );
}

/** The conversation this subtree was bound to, or null when none was. */
export function useScopedConversationId(): string | null {
  return React.useContext(ScopedConversationIdContext);
}
