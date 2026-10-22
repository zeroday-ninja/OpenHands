import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import { I18nKey } from "#/i18n/declaration";
import type { ImproveCitedSource } from "#/types/improve";

/**
 * The sources the builder based its change on. These are the evidence half of
 * a cycle: without them a reviewer cannot tell a researched change from a
 * guess, so an empty list is stated rather than omitted.
 */
export function ImproveCitedSources({
  sources,
}: {
  sources: ImproveCitedSource[];
}) {
  const { t } = useTranslation("openhands");

  return (
    <div data-testid="improve-cycle-sources" className="flex flex-col gap-1.5">
      <h5 className="text-xs font-semibold uppercase tracking-wide text-muted">
        {t(I18nKey.AUTOMATIONS$IMPROVE$SOURCES_TITLE)}
      </h5>
      {sources.length === 0 ? (
        <p className="text-xs text-muted">
          {t(I18nKey.AUTOMATIONS$IMPROVE$SOURCES_EMPTY)}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {sources.map((source) => (
            <li
              key={source.url}
              data-testid="improve-cycle-source"
              className="min-w-0 text-xs"
            >
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex max-w-full items-center gap-1 text-primary hover:underline"
              >
                <span className="truncate">{source.title || source.url}</span>
                <ExternalLink className="size-3 shrink-0" aria-hidden />
              </a>
              {source.note ? (
                <p className="mt-0.5 text-muted">{source.note}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
