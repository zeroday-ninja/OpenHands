/**
 * Overview or Details: whether the paper shows the map's layers or its parts.
 *
 * Beside the mode switch rather than inside it. Mode says whether the analysis
 * is drawn and layer says which analysis; this says at what height. It is
 * offered only when there is an overview to show — a map with one layer, or
 * the live work layer, has nothing to fold.
 */

import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";

export function ProjectMapViewSwitch({
  overview,
  onChange,
}: {
  overview: boolean;
  onChange: (overview: boolean) => void;
}) {
  const { t } = useTranslation("openhands");
  const options: {
    value: boolean;
    key: I18nKey;
    hint: I18nKey;
    testId: string;
  }[] = [
    {
      value: true,
      key: I18nKey.PROJECT_MAP$VIEW_OVERVIEW,
      hint: I18nKey.PROJECT_MAP$VIEW_OVERVIEW_HINT,
      testId: "project-map-view-overview",
    },
    {
      value: false,
      key: I18nKey.PROJECT_MAP$VIEW_DETAILS,
      hint: I18nKey.PROJECT_MAP$VIEW_DETAILS_HINT,
      testId: "project-map-view-details",
    },
  ];
  return (
    <div
      data-testid="project-map-view-switch"
      role="radiogroup"
      aria-label={t(I18nKey.PROJECT_MAP$VIEW_LABEL)}
      className="flex items-center gap-1 rounded-md border border-border-subtle p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.testId}
          type="button"
          role="radio"
          aria-checked={overview === option.value}
          title={t(option.hint)}
          data-testid={option.testId}
          className={`rounded px-2 py-1 text-micro ${
            overview === option.value
              ? "bg-surface-raised text-content"
              : "text-muted"
          }`}
          onClick={() => onChange(option.value)}
        >
          {t(option.key)}
        </button>
      ))}
    </div>
  );
}
