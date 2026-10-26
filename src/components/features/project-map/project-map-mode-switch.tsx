/**
 * Which layers the canvas draws.
 *
 * The mode — analysis, drawing, or both — is stored in the document, so a
 * repository whose map is mostly a hand-drawn diagram opens that way on every
 * machine the user works from, and for anyone else who checks it out. Which
 * derived layer is on the paper is not: looking at the agents is about the
 * person, not the repository, and it lives in the store with the other views.
 */

import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import { PROJECT_MAP_SECTION_LABEL_CLASS } from "./project-map-controls";
import {
  PROJECT_MAP_LAYER_IDS,
  PROJECT_MAP_MODES,
  type ProjectMapLayerId,
  type ProjectMapMode,
} from "#/types/project-map";
import { useProjectMapStore } from "#/stores/project-map-store";

const LAYER_LABELS: Record<ProjectMapLayerId, I18nKey> = {
  code: I18nKey.PROJECT_MAP$LAYER_CODE,
  work: I18nKey.PROJECT_MAP$LAYER_WORK,
};

// Plain words for each switch, on hover: "Analysis" and "Work" are labels a
// first visit has no reading for, and the row was the one part of the page
// left speaking its own jargon.
const LAYER_HINTS: Record<ProjectMapLayerId, I18nKey> = {
  code: I18nKey.PROJECT_MAP$LAYER_CODE_HINT,
  work: I18nKey.PROJECT_MAP$LAYER_WORK_HINT,
};

const MODE_HINTS: Record<ProjectMapMode, I18nKey> = {
  derived: I18nKey.PROJECT_MAP$MODE_DERIVED_HINT,
  freeform: I18nKey.PROJECT_MAP$MODE_FREEFORM_HINT,
  both: I18nKey.PROJECT_MAP$MODE_BOTH_HINT,
};

const MODE_LABELS: Record<ProjectMapMode, I18nKey> = {
  derived: I18nKey.PROJECT_MAP$MODE_DERIVED,
  freeform: I18nKey.PROJECT_MAP$MODE_FREEFORM,
  both: I18nKey.PROJECT_MAP$MODE_BOTH,
};

export function ProjectMapModeSwitch({
  mode,
  layer,
}: {
  mode: ProjectMapMode;
  layer: ProjectMapLayerId;
}) {
  const { t } = useTranslation("openhands");
  const setMode = useProjectMapStore((state) => state.setMode);
  const setLayer = useProjectMapStore((state) => state.setLayer);

  // Each group is captioned in plain words — "Show", "Map of" — because a
  // row of bare radio labels gave a first visit nothing to read them by.
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className={PROJECT_MAP_SECTION_LABEL_CLASS}>
        {t(I18nKey.PROJECT_MAP$MODE_CAPTION)}
      </span>
      <div
        data-testid="project-map-mode-switch"
        role="radiogroup"
        aria-label={t(I18nKey.PROJECT_MAP$MODE_LABEL)}
        className="flex items-center gap-1 rounded-md border border-border-subtle p-0.5"
      >
        {PROJECT_MAP_MODES.map((candidate) => (
          <button
            key={candidate}
            type="button"
            role="radio"
            aria-checked={mode === candidate}
            title={t(MODE_HINTS[candidate])}
            data-testid={`project-map-mode-${candidate}`}
            className={`rounded px-2 py-1 text-micro ${
              mode === candidate
                ? "bg-surface-raised text-content"
                : "text-muted"
            }`}
            onClick={() => setMode(candidate)}
          >
            {t(MODE_LABELS[candidate])}
          </button>
        ))}
      </div>

      {/* Which derived layer is on the paper. Separate from the mode above:
          one says whether the drawing is shown, the other says what the
          drawing is over. */}
      <span className={PROJECT_MAP_SECTION_LABEL_CLASS}>
        {t(I18nKey.PROJECT_MAP$LAYER_CAPTION)}
      </span>
      <div
        data-testid="project-map-layer-switch"
        role="radiogroup"
        aria-label={t(I18nKey.PROJECT_MAP$LAYER_LABEL)}
        className="flex items-center gap-1 rounded-md border border-border-subtle p-0.5"
      >
        {PROJECT_MAP_LAYER_IDS.map((candidate) => (
          <button
            key={candidate}
            type="button"
            role="radio"
            aria-checked={layer === candidate}
            title={t(LAYER_HINTS[candidate])}
            data-testid={`project-map-layer-${candidate}`}
            className={`rounded px-2 py-1 text-micro ${
              layer === candidate
                ? "bg-surface-raised text-content"
                : "text-muted"
            }`}
            onClick={() => setLayer(candidate)}
          >
            {t(LAYER_LABELS[candidate])}
          </button>
        ))}
      </div>
    </div>
  );
}
