import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "test-utils";
import { EventMessage } from "#/components/conversation-events/chat/event-message";
import { useAgentState } from "#/hooks/use-agent-state";
import { AgentState } from "#/types/agent-state";
import {
  adapterIncidentKey,
  useAdapterIncidentsStore,
} from "#/stores/adapter-incidents-store";
import type { ACPAdapterIncidentEvent } from "#/types/agent-server/core/events/acp-adapter-incident-event";

vi.mock("#/hooks/query/use-config", () => ({
  useConfig: () => ({ data: { APP_MODE: "local" } }),
}));
vi.mock("#/hooks/use-agent-state");
vi.mock("#/hooks/use-conversation-id", () => ({
  useOptionalConversationId: () => ({ conversationId: "c1" }),
  useConversationId: () => ({ conversationId: "c1" }),
}));

const event: ACPAdapterIncidentEvent = {
  kind: "ACPAdapterIncidentEvent",
  id: "inc-1",
  timestamp: "2026-10-26T05:00:00Z",
  source: "environment",
  adapter: "antigravity",
  what: "step",
  unrecognised_kind: "review_note",
  detail: "[unrecognised step: 'review_note']",
};

function render() {
  return renderWithProviders(
    <EventMessage
      event={event}
      messages={[]}
      isLastMessage={false}
      isInLast10Actions={false}
    />,
  );
}

describe("EventMessage - ACPAdapterIncidentEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAgentState).mockReturnValue({
      curAgentState: AgentState.INIT,
      executionStatus: null,
    });
    useAdapterIncidentsStore.setState({ records: {} });
  });

  it("shows the incident as a notice that names the adapter and what it could not read", () => {
    render();

    // The test i18n carries no copy, so the words are keys; what the notice
    // is about is read from the attributes the harness reads too.
    const notice = screen.getByTestId("adapter-incident-event");
    expect(notice).toHaveAttribute("data-adapter", "antigravity");
    expect(notice).toHaveAttribute("data-what", "step");
    expect(notice).toHaveAttribute("data-kind", "review_note");
    expect(notice).toHaveTextContent("ACP_INCIDENT$BODY");
    // Nothing filed yet: no claim either way.
    expect(screen.queryByTestId("adapter-incident-status")).toBeNull();
  });

  it("says whether the incident was filed as a lesson, or why not", () => {
    const key = adapterIncidentKey({
      conversationId: "c1",
      adapter: "antigravity",
      what: "step",
      kind: "review_note",
    });
    useAdapterIncidentsStore.getState().begin(key, {
      conversationId: "c1",
      adapter: "antigravity",
      what: "step",
      kind: "review_note",
      at: "2026-10-26T05:00:00Z",
    });
    useAdapterIncidentsStore.getState().settle(key, { lessonId: "L1" });
    const { unmount } = render();
    expect(screen.getByTestId("adapter-incident-event")).toHaveAttribute(
      "data-recorded",
      "true",
    );
    expect(screen.getByTestId("adapter-incident-status")).toHaveTextContent(
      "ACP_INCIDENT$RECORDED",
    );
    unmount();

    useAdapterIncidentsStore
      .getState()
      .settle(key, { error: "automation unreachable" });
    render();
    expect(screen.getByTestId("adapter-incident-event")).toHaveAttribute(
      "data-recorded",
      "false",
    );
    expect(screen.getByTestId("adapter-incident-event")).toHaveAttribute(
      "data-error",
      "automation unreachable",
    );
    expect(screen.getByTestId("adapter-incident-status")).toHaveTextContent(
      "ACP_INCIDENT$NOT_RECORDED",
    );
  });
});
