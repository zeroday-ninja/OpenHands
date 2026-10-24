import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../../../test-utils";
import { server } from "../../../../src/mocks/node";
import { ProjectMapWaiting } from "#/components/features/project-map/project-map-waiting";
import { MOCK_PARKED_CYCLE } from "#/fixtures/improve-program";

const PARKED_PATH = "*/api/automation/v1/improve/parked";
const RESOLVE_PATH = "*/api/automation/v1/improve/cycles/:cycleId/resolve";

describe("ProjectMapWaiting", () => {
  it("shows the question with the plan it cannot be answered without", async () => {
    renderWithProviders(<ProjectMapWaiting />);

    await screen.findByTestId("project-map-waiting");
    expect(
      screen.getByText(/renames the conversation socket/i),
    ).toBeInTheDocument();
    // The sentences the service writes when the builder supplied nothing: a
    // blank rollback would read as a change that needs no rollback.
    expect(
      screen.getByTestId("project-map-waiting-plan-rollback"),
    ).toHaveTextContent(/Not stated by the builder/);
    expect(
      screen.getByTestId("project-map-waiting-plan-consumers"),
    ).toHaveTextContent(/did not say who depends/);
  });

  it("renders nothing when nothing is waiting", async () => {
    server.use(
      http.get(PARKED_PATH, () => HttpResponse.json({ cycles: [], total: 0 })),
    );

    renderWithProviders(<ProjectMapWaiting />);

    // A panel that says "no parked work" on every visit teaches the reader to
    // stop looking at it.
    await waitFor(() =>
      expect(screen.queryByTestId("project-map-waiting")).toBeNull(),
    );
  });

  it("renders nothing when the backend cannot park anything", async () => {
    // An automations service from before the gate landed answers 404 here.
    // That is not an error to put in front of the user.
    server.use(
      http.get(PARKED_PATH, () =>
        HttpResponse.json({ detail: "Not Found" }, { status: 404 }),
      ),
    );

    renderWithProviders(<ProjectMapWaiting />);

    await waitFor(() =>
      expect(screen.queryByTestId("project-map-waiting")).toBeNull(),
    );
  });

  it("will not send an answer with no reasoning behind it", async () => {
    const resolved = vi.fn();
    server.use(
      http.post(RESOLVE_PATH, async () => {
        resolved();
        return HttpResponse.json(MOCK_PARKED_CYCLE);
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<ProjectMapWaiting />);
    await screen.findByTestId("project-map-waiting");

    // An answer with no reasoning has to be guessed at again next time, which
    // is the repetition this surface exists to end.
    const publish = screen.getByTestId("project-map-waiting-route-approve");
    expect(publish).toBeDisabled();
    await user.click(publish);
    expect(resolved).not.toHaveBeenCalled();
  });

  it("sends the route and the reason once there is one", async () => {
    const sent: unknown[] = [];
    server.use(
      http.post(RESOLVE_PATH, async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json(MOCK_PARKED_CYCLE);
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<ProjectMapWaiting />);
    await screen.findByTestId("project-map-waiting");

    await user.type(
      screen.getByTestId("project-map-waiting-reason"),
      "The client release is out.",
    );
    await user.click(screen.getByTestId("project-map-waiting-route-approve"));

    await waitFor(() =>
      expect(sent).toEqual([
        { route: "approve", resolution: "The client release is out." },
      ]),
    );
  });

  it("never offers escalate, because answering is the escalation", async () => {
    renderWithProviders(<ProjectMapWaiting />);
    await screen.findByTestId("project-map-waiting");

    expect(
      screen.queryByTestId("project-map-waiting-route-escalate"),
    ).toBeNull();
    for (const route of ["approve", "cycle", "return", "archive"]) {
      expect(
        screen.getByTestId(`project-map-waiting-route-${route}`),
      ).toBeInTheDocument();
    }
  });

  it("says the answer did not land rather than looking like it did", async () => {
    server.use(
      http.post(RESOLVE_PATH, () =>
        HttpResponse.json({ detail: "Conflict" }, { status: 409 }),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<ProjectMapWaiting />);
    await screen.findByTestId("project-map-waiting");

    await user.type(
      screen.getByTestId("project-map-waiting-reason"),
      "Publish it.",
    );
    await user.click(screen.getByTestId("project-map-waiting-route-approve"));

    expect(
      await screen.findByTestId("project-map-waiting-error"),
    ).toBeInTheDocument();
  });
});
