import React from "react";
import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test-utils";
import AutomationService from "#/api/automation-service/automation-service.api";
import SoulService from "#/api/soul-service/soul-service.api";
import { useRecordAdapterIncidents } from "#/hooks/use-record-adapter-incidents";
import { useAdapterIncidentsStore } from "#/stores/adapter-incidents-store";
import { useEventStore } from "#/stores/use-event-store";
import type { ACPAdapterIncidentEvent } from "#/types/agent-server/core/events/acp-adapter-incident-event";
import type { Lesson } from "#/types/improve";

function Probe() {
  useRecordAdapterIncidents();
  return null;
}

function incident(
  overrides: Partial<ACPAdapterIncidentEvent> = {},
): ACPAdapterIncidentEvent {
  return {
    kind: "ACPAdapterIncidentEvent",
    id: `inc-${Math.random().toString(36).slice(2)}`,
    timestamp: "2026-10-26T05:00:00Z",
    source: "environment",
    adapter: "antigravity",
    what: "step",
    unrecognised_kind: "review_note",
    detail: "[unrecognised step: 'review_note']",
    ...overrides,
  };
}

function captured(id: string) {
  return {
    lesson: { id } as Lesson,
    repeat: false,
    failed_stage: null,
    failure_detail: null,
  };
}

describe("useRecordAdapterIncidents", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useAdapterIncidentsStore.setState({ records: {} });
    useEventStore.getState().clearEvents();
    vi.spyOn(SoulService, "mergeMemory").mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useEventStore.getState().clearEvents();
  });

  it("files each sighting once, against the runtime, and writes it to memory", async () => {
    // Arrange
    const capture = vi
      .spyOn(AutomationService, "captureLesson")
      .mockResolvedValue(captured("L1"));
    renderWithProviders(<Probe />, {
      navigation: { currentPath: "/conversations/c1", conversationId: "c1" },
    });

    // Act: the adapter reports the same gap twice in one session, and a
    // different gap once.
    const first = incident();
    useEventStore.getState().addEvent(first);
    useEventStore.getState().addEvent(incident({ id: "inc-again" }));
    useEventStore
      .getState()
      .addEvent(incident({ id: "inc-other", unrecognised_kind: "usage_note" }));

    // Assert: two lessons, not three — one per gap — in the runtime's scope,
    // with words that say what and where.
    await waitFor(() => expect(capture).toHaveBeenCalledTimes(2));
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "runtime",
        subject: "antigravity",
        trigger: "adapter_incident",
        text: expect.stringContaining("'review_note'"),
        source: expect.objectContaining({
          conversation_id: "c1",
          event_id: first.id,
          what: "step",
        }),
      }),
    );
    await waitFor(() =>
      expect(
        Object.values(useAdapterIncidentsStore.getState().records).map(
          (record) => record.lessonId,
        ),
      ).toEqual(["L1", "L1"]),
    );
    // And the readable copy, once per lesson.
    await waitFor(() =>
      expect(SoulService.mergeMemory).toHaveBeenCalledTimes(2),
    );
  });

  it("files a dead adapter with the SDK's account of what it came to", async () => {
    const capture = vi
      .spyOn(AutomationService, "captureLesson")
      .mockResolvedValue(captured("L2"));
    renderWithProviders(<Probe />, {
      navigation: { currentPath: "/conversations/c1", conversationId: "c1" },
    });

    useEventStore.getState().addEvent(
      incident({
        id: "inc-dead",
        what: "process",
        unrecognised_kind: null,
        detail:
          "the antigravity adapter exited with code 137; last stderr: AGY_ADAPTER_CRASH: ValueError: boom",
      }),
    );

    await waitFor(() => expect(capture).toHaveBeenCalledTimes(1));
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "runtime",
        subject: "antigravity",
        trigger: "adapter_incident",
        text: expect.stringContaining("exited with code 137"),
      }),
    );
  });

  it("keeps a filing that failed as a failure, and does not retry it on every render", async () => {
    // Arrange: the automation service is unreachable.
    const capture = vi
      .spyOn(AutomationService, "captureLesson")
      .mockRejectedValue(new Error("automation unreachable"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderWithProviders(<Probe />, {
      navigation: { currentPath: "/conversations/c1", conversationId: "c1" },
    });

    // Act
    useEventStore.getState().addEvent(incident({ id: "inc-1" }));
    await waitFor(() => expect(capture).toHaveBeenCalledTimes(1));
    // Another event arriving re-runs the effect over the same list.
    useEventStore.getState().addEvent({
      kind: "MessageEvent",
      id: "msg-1",
      timestamp: "2026-10-26T05:00:01Z",
      source: "agent",
      llm_message: {
        role: "assistant",
        content: [{ type: "text", text: "hi" }],
      },
      activated_skills: [],
      extended_content: [],
    } as never);

    // Assert: said on the record, not swallowed; and not filed again.
    await waitFor(() =>
      expect(
        Object.values(useAdapterIncidentsStore.getState().records)[0],
      ).toMatchObject({ lessonId: null, error: "automation unreachable" }),
    );
    expect(capture).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    expect(SoulService.mergeMemory).not.toHaveBeenCalled();
  });
});
