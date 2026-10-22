import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import type { ImproveCycle } from "#/types/improve";
import { extensionModuleEmptyStateClassName } from "#/utils/extension-module-card-classes";
import { ImproveCycleCard } from "./improve-cycle-card";

interface ImproveCycleHistoryProps {
  cycles: ImproveCycle[];
  /** Every cycle the program has recorded, not just this page. */
  total: number;
}

/** The program's cycles, newest first. */
export function ImproveCycleHistory({
  cycles,
  total,
}: ImproveCycleHistoryProps) {
  const { t } = useTranslation("openhands");

  return (
    <section
      data-testid="improve-cycle-history"
      aria-labelledby="improve-cycles-heading"
      className="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3
          id="improve-cycles-heading"
          className="text-base font-semibold text-foreground"
        >
          {t(I18nKey.AUTOMATIONS$IMPROVE$CYCLES_TITLE)}
        </h3>
        {cycles.length < total ? (
          <span
            data-testid="improve-cycles-count"
            className="text-xs text-muted"
          >
            {t(I18nKey.AUTOMATIONS$IMPROVE$CYCLES_COUNT, {
              shown: cycles.length,
              total,
            })}
          </span>
        ) : null}
      </div>

      {cycles.length === 0 ? (
        <div
          data-testid="improve-cycles-empty"
          className={extensionModuleEmptyStateClassName}
        >
          <h4 className="text-sm font-semibold text-contrast">
            {t(I18nKey.AUTOMATIONS$IMPROVE$NO_CYCLES_TITLE)}
          </h4>
          <p className="mt-2 text-sm text-tertiary-light">
            {t(I18nKey.AUTOMATIONS$IMPROVE$NO_CYCLES_BODY)}
          </p>
        </div>
      ) : (
        <ol className="flex flex-col gap-3">
          {cycles.map((cycle) => (
            <ImproveCycleCard key={cycle.id} cycle={cycle} />
          ))}
        </ol>
      )}
    </section>
  );
}
