import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../../../test-utils";
import { FeatureAnnouncement } from "#/components/features/feature-trials/feature-announcement";
import { FEATURE_TRIALS } from "#/features/feature-trials";
import {
  clearFeatureTrials,
  useFeatureTrialStore,
} from "#/stores/feature-trial-store";

const [TRIAL] = FEATURE_TRIALS;

describe("FeatureAnnouncement", () => {
  beforeEach(() => clearFeatureTrials());
  // A case that appends a step's target and then fails leaves it in the body,
  // where the next case's `querySelector` finds it instead of its own.
  afterEach(() => {
    vi.restoreAllMocks();
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    clearFeatureTrials();
    window.document
      .querySelectorAll(`[data-testid="${TRIAL.steps[0].testId}"]`)
      .forEach((element) => element.remove());
  });

  it("walks the steps and only rates at the end", async () => {
    const user = userEvent.setup();
    renderWithProviders(<FeatureAnnouncement trials={[TRIAL]} />);

    const panel = await screen.findByTestId("feature-announcement");
    expect(panel).toHaveAttribute("data-step", "0");
    // The rating belongs after the explanation: asking before the walkthrough
    // is asking about something the reader has not seen.
    expect(screen.queryByTestId("feature-rating")).toBeNull();

    await user.click(screen.getByTestId("feature-announcement-next"));

    expect(panel).toHaveAttribute("data-step", "1");
    expect(screen.getByTestId("feature-rating")).toBeInTheDocument();
  });

  it("points at the element each step is about", async () => {
    const target = window.document.createElement("div");
    target.setAttribute("data-testid", TRIAL.steps[0].testId as string);
    window.document.body.appendChild(target);

    renderWithProviders(<FeatureAnnouncement trials={[TRIAL]} />);

    // Applied to the real element rather than drawn over it, so a step points
    // at what is actually on screen.
    await waitFor(() => expect(target.className).toContain("outline"));
    target.remove();
  });

  it("leaves the page where it is when the step's target is already on screen", async () => {
    // Arrange: a target the reader can already see, which is the usual case —
    // a step points at something beside the panel.
    const target = window.document.createElement("div");
    target.setAttribute("data-testid", TRIAL.steps[0].testId as string);
    const scrollIntoView = vi.fn();
    Object.defineProperty(target, "scrollIntoView", { value: scrollIntoView });
    Object.defineProperty(target, "getBoundingClientRect", {
      value: () => ({ top: 20, bottom: 300, left: 0, right: 100 }),
    });
    window.document.body.appendChild(target);

    // Act
    renderWithProviders(<FeatureAnnouncement trials={[TRIAL]} />);
    await screen.findByTestId("feature-announcement");
    await waitFor(() => expect(target.className).toContain("outline"));

    // Assert: no scroll at all. A target in the same scrolling column as this
    // panel, and taller than it, took the map's rail 1421 px down a 627 px
    // column and left the explanation off screen.
    expect(scrollIntoView).not.toHaveBeenCalled();
    target.remove();
  });

  it("undoes a scroll that cost the reader this panel", async () => {
    // Arrange: a panel that ends up clipped by the scroll its own step asks
    // for, which is the home screen's geometry — the target sits just below
    // the fold and the panel starts at the top of the same column.
    const scrolled: string[] = [];
    // jsdom has no `scrollIntoView` to spy on, so the recorder is the
    // implementation. Removed again in `afterEach`.
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: function record(this: Element) {
        scrolled.push(this.getAttribute("data-testid") ?? this.tagName);
      },
    });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function clipped(this: Element) {
        const panel =
          this.getAttribute("data-testid") === "feature-announcement";
        return {
          top: panel ? -40 : 0,
          bottom: panel ? 200 : 0,
          left: 0,
          right: 0,
          width: 0,
          height: 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      },
    );
    const target = window.document.createElement("div");
    target.setAttribute("data-testid", TRIAL.steps[0].testId as string);
    window.document.body.appendChild(target);

    // Act
    renderWithProviders(<FeatureAnnouncement trials={[TRIAL]} />);
    await screen.findByTestId("feature-announcement");

    // Assert: the panel is scrolled back after the target, so the last word
    // on where the view sits belongs to the explanation.
    await waitFor(() => expect(scrolled.at(-1)).toBe("feature-announcement"));
    target.remove();
  });

  it("brings a target that is off screen into view", async () => {
    // Arrange: jsdom gives every element a zero-sized box, which reads as
    // off screen.
    const target = window.document.createElement("div");
    target.setAttribute("data-testid", TRIAL.steps[0].testId as string);
    const scrollIntoView = vi.fn();
    Object.defineProperty(target, "scrollIntoView", { value: scrollIntoView });
    window.document.body.appendChild(target);

    // Act
    renderWithProviders(<FeatureAnnouncement trials={[TRIAL]} />);

    // Assert: the smallest scroll that shows it, never a centred one.
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(scrollIntoView.mock.calls[0][0]).toMatchObject({ block: "nearest" });
    target.remove();
  });

  it("renders at all when the element a step names is missing", async () => {
    // A walkthrough whose target has moved must still explain itself. The
    // alternative — rendering nothing — is a feature that shipped silently.
    renderWithProviders(<FeatureAnnouncement trials={[TRIAL]} />);

    expect(await screen.findByTestId("feature-announcement")).toBeInTheDocument();
  });

  it("comes back after Later, and not after Got it", async () => {
    const user = userEvent.setup();
    const { unmount } = renderWithProviders(
      <FeatureAnnouncement trials={[TRIAL]} />,
    );
    await screen.findByTestId("feature-announcement");

    // Later: dismissed for this visit only. An announcement nobody read is
    // an announcement that did not happen, and marking it shown would start
    // the unused clock on a feature nobody heard about.
    await user.click(screen.getByTestId("feature-announcement-later"));
    expect(screen.queryByTestId("feature-announcement")).toBeNull();
    expect(
      useFeatureTrialStore.getState().records[TRIAL.id]?.announcedAt ?? null,
    ).toBeNull();
    unmount();

    const again = renderWithProviders(<FeatureAnnouncement trials={[TRIAL]} />);
    await screen.findByTestId("feature-announcement");
    await user.click(screen.getByTestId("feature-announcement-next"));
    await user.click(screen.getByTestId("feature-announcement-done"));

    expect(screen.queryByTestId("feature-announcement")).toBeNull();
    expect(
      useFeatureTrialStore.getState().records[TRIAL.id].announcedAt,
    ).toBeTruthy();
    again.unmount();

    renderWithProviders(<FeatureAnnouncement trials={[TRIAL]} />);
    await waitFor(() =>
      expect(screen.queryByTestId("feature-announcement")).toBeNull(),
    );
  });

  it("renders nothing when this route has nothing new", () => {
    renderWithProviders(<FeatureAnnouncement trials={[]} />);

    expect(screen.queryByTestId("feature-announcement")).toBeNull();
  });
});
