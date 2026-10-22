import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NavigationProvider } from "#/context/navigation-context";
import { ScopedConversationIdProvider } from "#/context/scoped-conversation-id-context";
import { useOptionalConversationId } from "#/hooks/use-conversation-id";

/**
 * `useOptionalConversationId` is what binds every conversation hook to a
 * conversation, and `/conversations/:conversationId` is its load-bearing
 * caller. The scoped override exists for pages that host a conversation the
 * URL does not name; these cases pin down that it never reaches a subtree that
 * did not ask for it.
 */
function Reader({ testId }: { testId: string }) {
  const { conversationId } = useOptionalConversationId();
  return <span data-testid={testId}>{conversationId ?? "none"}</span>;
}

function withRoute(children: React.ReactNode, conversationId: string | null) {
  return (
    <NavigationProvider
      value={{
        currentPath:
          conversationId === null ? "/map" : `/conversations/${conversationId}`,
        conversationId,
        isNavigating: false,
        navigate: () => {},
      }}
    >
      {children}
    </NavigationProvider>
  );
}

describe("useOptionalConversationId", () => {
  it("answers from the route when no scope is mounted", () => {
    // Arrange / Act
    render(withRoute(<Reader testId="route-reader" />, "route-conversation"));

    // Assert
    expect(screen.getByTestId("route-reader")).toHaveTextContent(
      "route-conversation",
    );
  });

  it("answers from the scope when one is mounted", () => {
    // Arrange / Act: the map page's case — no conversation in the URL.
    render(
      withRoute(
        <ScopedConversationIdProvider conversationId="pane-conversation">
          <Reader testId="scoped-reader" />
        </ScopedConversationIdProvider>,
        null,
      ),
    );

    // Assert
    expect(screen.getByTestId("scoped-reader")).toHaveTextContent(
      "pane-conversation",
    );
  });

  it("leaves readers outside the scope on the route's id", () => {
    // Arrange / Act: the same component mounted inside and beside a scope, as
    // the sidebar and a pane are on one page.
    render(
      withRoute(
        <>
          <ScopedConversationIdProvider conversationId="pane-conversation">
            <Reader testId="inside" />
          </ScopedConversationIdProvider>
          <Reader testId="outside" />
        </>,
        "route-conversation",
      ),
    );

    // Assert: the override reaches its own subtree and nothing else, so a
    // conversation route keeps resolving its own id.
    expect(screen.getByTestId("inside")).toHaveTextContent("pane-conversation");
    expect(screen.getByTestId("outside")).toHaveTextContent(
      "route-conversation",
    );
  });
});
