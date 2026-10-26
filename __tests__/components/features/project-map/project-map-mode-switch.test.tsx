import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../../../../test-utils";
import { ProjectMapModeSwitch } from "#/components/features/project-map/project-map-mode-switch";
import { ProjectMapViewSwitch } from "#/components/features/project-map/project-map-view-switch";

describe("the map's switches", () => {
  it("say in plain words what each setting shows, on hover", () => {
    // "Analysis", "Work", "Details" are labels a first visit has no reading
    // for. The test i18n returns keys, so the hint's presence is what is
    // asserted; its words live in the translation file.
    renderWithProviders(
      <>
        <ProjectMapModeSwitch mode="derived" layer="code" />
        <ProjectMapViewSwitch overview onChange={() => undefined} />
      </>,
    );

    expect(screen.getByTestId("project-map-mode-derived")).toHaveAttribute(
      "title",
      "PROJECT_MAP$MODE_DERIVED_HINT",
    );
    expect(screen.getByTestId("project-map-mode-freeform")).toHaveAttribute(
      "title",
      "PROJECT_MAP$MODE_FREEFORM_HINT",
    );
    expect(screen.getByTestId("project-map-layer-work")).toHaveAttribute(
      "title",
      "PROJECT_MAP$LAYER_WORK_HINT",
    );
    expect(screen.getByTestId("project-map-view-overview")).toHaveAttribute(
      "title",
      "PROJECT_MAP$VIEW_OVERVIEW_HINT",
    );
    expect(screen.getByTestId("project-map-view-details")).toHaveAttribute(
      "title",
      "PROJECT_MAP$VIEW_DETAILS_HINT",
    );
  });
});
