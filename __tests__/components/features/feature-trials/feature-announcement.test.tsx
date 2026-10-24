import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
  afterEach(() => clearFeatureTrials());

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
