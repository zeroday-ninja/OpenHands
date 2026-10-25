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
        return HttpResponse.json(
          { lesson: {}, repeat: false },
          { status: 201 },
        );
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<FeatureRating trial={TRIAL} />);

    // A form that demands prose collects nothing.
    await user.click(screen.getByTestId("feature-rating-up"));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(useFeatureTrialStore.getState().records[TRIAL.id].rating).toBe("up");
  });

  it("files the correction in MEMORY.md, where a person can read it", async () => {
    // Injection into the next cycle was built; filing it in the document that
    // owns it was not, so a correction lived in a database row and in prompts
    // nobody reads. The rule asks for both.
    const filed: string[] = [];
    server.use(
      http.post(LESSONS_PATH, () =>
        HttpResponse.json(
          { lesson: { id: "lesson-7" }, repeat: false },
          { status: 201 },
        ),
      ),
      http.get("*/api/soul/documents/memory", () =>
        HttpResponse.json({
          name: "memory",
          content:
            "## 2026-10-01T00:00:00Z — Earlier\n<!-- id: mem-a -->\n\nTheirs.\n",
          exists: true,
          size_bytes: 10,
        }),
      ),
      http.put("*/api/soul/documents/memory", async ({ request }) => {
        const body = (await request.json()) as { content: string };
        filed.push(body.content);
        return HttpResponse.json({
          name: "memory",
          content: body.content,
          exists: true,
          size_bytes: body.content.length,
        });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<FeatureRating trial={TRIAL} />);

    await user.click(screen.getByTestId("feature-rating-down"));

    await waitFor(() => expect(filed).toHaveLength(1));
    // Appended, with the user's earlier entry untouched, and carrying an id
    // so the cross-backend merge can take a union rather than duplicate it.
    expect(filed[0]).toContain("<!-- id: mem-a -->");
    expect(filed[0]).toContain("<!-- id: lesson-lesson-7 -->");
    expect(filed[0]).toContain("Correction (surface: ");
  });

  it("keeps the rating when the document cannot be written", async () => {
    // The correction is already captured by the time it is filed. Failing the
    // mutation here would tell the user their rating did not land when it did.
    server.use(
      http.post(LESSONS_PATH, () =>
        HttpResponse.json(
          { lesson: { id: "lesson-8" }, repeat: false },
          { status: 201 },
        ),
      ),
      http.get("*/api/soul/documents/memory", () =>
        HttpResponse.json({ detail: "no identity documents" }, { status: 404 }),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<FeatureRating trial={TRIAL} />);

    await user.click(screen.getByTestId("feature-rating-down"));

    await waitFor(() =>
      expect(useFeatureTrialStore.getState().records[TRIAL.id].rating).toBe(
        "down",
      ),
    );
  });

  it("sends a thumbs-down as a correction rather than a vote", async () => {
    const sent: Record<string, unknown>[] = [];
    server.use(
      http.post(LESSONS_PATH, async ({ request }) => {
        sent.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(
          { lesson: {}, repeat: false },
          { status: 201 },
        );
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
