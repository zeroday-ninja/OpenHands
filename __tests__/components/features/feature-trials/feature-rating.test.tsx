import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderWithProviders } from "../../../../test-utils";
import { server } from "../../../../src/mocks/node";
import { FeatureRating } from "#/components/features/feature-trials/feature-rating";
import { FEATURE_TRIALS } from "#/features/feature-trials";
import {
  clearFeatureTrials,
  useFeatureTrialStore,
} from "#/stores/feature-trial-store";

const LESSONS_PATH = "*/api/automation/v1/lessons";
const [TRIAL] = FEATURE_TRIALS;

describe("FeatureRating", () => {
  beforeEach(() => clearFeatureTrials());
  afterEach(() => clearFeatureTrials());

  it("takes one click as a complete answer", async () => {
    const sent: unknown[] = [];
    server.use(
      http.post(LESSONS_PATH, async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json({ lesson: {}, repeat: false }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<FeatureRating trial={TRIAL} />);

    // A form that demands prose collects nothing.
    await user.click(screen.getByTestId("feature-rating-up"));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(useFeatureTrialStore.getState().records[TRIAL.id].rating).toBe("up");
  });

  it("sends a thumbs-down as a correction rather than a vote", async () => {
    const sent: Record<string, unknown>[] = [];
    server.use(
      http.post(LESSONS_PATH, async ({ request }) => {
        sent.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ lesson: {}, repeat: false }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<FeatureRating trial={TRIAL} />);

    await user.type(
      screen.getByTestId("feature-rating-comment"),
      "It buried the question under the plan.",
    );
    await user.click(screen.getByTestId("feature-rating-down"));

    // Filed under learn-a-lesson-once, scoped to the surface it was about,
    // in the user's own words — so it reaches the next cycle without the
    // user having to accept a proposal first.
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      scope: "surface",
      subject: TRIAL.id,
      trigger: "thumbs_down",
      text: "It buried the question under the plan.",
    });
  });

  it("will not send a comment with no rating to be a comment on", async () => {
    const user = userEvent.setup();
    renderWithProviders(<FeatureRating trial={TRIAL} />);

    await user.type(screen.getByTestId("feature-rating-comment"), "Hmm.");

    expect(screen.getByTestId("feature-rating-comment-send")).toBeDisabled();
  });

  it("keeps the rating and says so when it did not reach the agents", async () => {
    server.use(
      http.post(LESSONS_PATH, () =>
        HttpResponse.json({ detail: "nope" }, { status: 500 }),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<FeatureRating trial={TRIAL} />);

    await user.click(screen.getByTestId("feature-rating-down"));

    // A rating that silently vanished is worse than none, because the person
    // believes they have told you.
    const outcome = await screen.findByTestId("feature-rating-outcome");
    await waitFor(() =>
      expect(outcome).toHaveAttribute("data-reached-agents", "false"),
    );
    expect(useFeatureTrialStore.getState().records[TRIAL.id].rating).toBe(
      "down",
    );
  });

  it("does not erase the comment that explained the last rating", async () => {
    server.use(
      http.post(LESSONS_PATH, () =>
        HttpResponse.json({ lesson: {}, repeat: false }, { status: 201 }),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<FeatureRating trial={TRIAL} />);

    await user.type(screen.getByTestId("feature-rating-comment"), "Too noisy.");
    await user.click(screen.getByTestId("feature-rating-down"));
    await user.clear(screen.getByTestId("feature-rating-comment"));
    await user.click(screen.getByTestId("feature-rating-up"));

    const record = useFeatureTrialStore.getState().records[TRIAL.id];
    expect(record.rating).toBe("up");
    expect(record.comment).toBe("Too noisy.");
  });
});
