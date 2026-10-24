/**
 * Which layers the canvas draws.
 *
 * Stored in the document rather than in a preference, so a repository whose
 * map is mostly a hand-drawn diagram opens that way on every machine the user
 * works from, and for anyone else who checks it out.
 */

import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import { PROJECT_MAP_MODES, type ProjectMapMode } from "#/types/project-map";
import { useProjectMapStore } from "#/stores/project-map-store";

const MODE_LABELS: Record<ProjectMapMode, I18nKey> = {
  derived: I18nKey.PROJECT_MAP$MODE_DERIVED,
  freeform: I18nKey.PROJECT_MAP$MODE_FREEFORM,
  both: I18nKey.PROJECT_MAP$MODE_BOTH,
};

export function ProjectMapModeSwitch({ mode }: { mode: ProjectMapMode }) {
  const { t } = useTranslation("openhands");
  const setMode = useProjectMapStore((state) => state.setMode);

  return (
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
          data-testid={`project-map-mode-${candidate}`}
          className={`rounded px-2 py-1 text-micro ${
            mode === candidate ? "bg-surface-raised text-content" : "text-muted"
          }`}
          onClick={() => setMode(candidate)}
        >
          {t(MODE_LABELS[candidate])}
        </button>
      ))}
    </div>
  );
}
