import { useTranslation } from "react-i18next";
import { ArrowRight, GitBranch } from "lucide-react";
import { I18nKey } from "#/i18n/declaration";
import { NavigationLink } from "#/components/shared/navigation-link";
import type { ImproveCycleRepository, ImproveVerdict } from "#/types/improve";
import { improveRepositoryDisplayName } from "#/utils/improve-program";
import { extensionModuleEmptyStateClassName } from "#/utils/extension-module-card-classes";
import { cn } from "#/utils/utils";
import { ImproveVerdictBadge } from "./improve-verdict-badge";

const GIT_SYNC_REPOSITORIES_PATH = "/automations/git-sync";

/**
 * A program with an empty rotation has nothing its runs can take, so the page
 * says so and points at the page where repositories are added rather than
 * rendering an empty list.
 */
function EmptyRotation() {
  const { t } = useTranslation("openhands");

  return (
    <div
      data-testid="improve-rotation-empty"
      className={extensionModuleEmptyStateClassName}
    >
      <h4 className="text-sm font-semibold text-contrast">
        {t(I18nKey.AUTOMATIONS$IMPROVE$ROTATION_EMPTY_TITLE)}
      </h4>
      <p className="mt-2 text-sm text-tertiary-light">
        {t(I18nKey.AUTOMATIONS$IMPROVE$ROTATION_EMPTY_BODY)}
      </p>
      <NavigationLink
        to={GIT_SYNC_REPOSITORIES_PATH}
        className="mt-4 inline-flex items-center gap-1 text-sm text-primary hover:underline"
      >
        {t(I18nKey.AUTOMATIONS$IMPROVE$ROTATION_EMPTY_LINK)}
        <ArrowRight className="size-3.5" aria-hidden />
      </NavigationLink>
    </div>
  );
}

interface RotationEntryProps {
  repository: ImproveCycleRepository;
  isUpNext: boolean;
  lastVerdict: ImproveVerdict | undefined;
}

function RotationEntry({
  repository,
  isUpNext,
  lastVerdict,
}: RotationEntryProps) {
  const { t } = useTranslation("openhands");
  const name = improveRepositoryDisplayName(repository);

  return (
    <li
      data-testid="improve-rotation-entry"
      data-repository={repository.url}
      data-up-next={isUpNext}
      className={cn(
        "flex min-w-0 items-center justify-between gap-3 rounded-xl border px-4 py-3",
        isUpNext
          ? "border-primary bg-primary/10"
          : "border-border bg-surface-raised",
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        {/* The <ol> already conveys order to assistive tech, so the number
            is decorative rather than a second, competing announcement. */}
        <span aria-hidden className="shrink-0 text-xs tabular-nums text-muted">
          {repository.index + 1}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-content">{name}</p>
          {repository.ref ? (
            <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted">
              <GitBranch className="size-3" aria-hidden />
              {repository.ref}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {lastVerdict !== undefined ? (
          <span
            data-testid="improve-rotation-last-verdict"
            className="flex items-center gap-1.5"
          >
            <span className="text-xs text-muted">
              {t(I18nKey.AUTOMATIONS$IMPROVE$LAST_VERDICT)}
            </span>
            <ImproveVerdictBadge
              verdict={lastVerdict}
              testId="improve-rotation-verdict-badge"
            />
          </span>
        ) : null}
        {isUpNext ? (
          <span
            data-testid="improve-rotation-up-next"
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-2.5 py-1 text-xs font-semibold text-[var(--oh-accent-foreground)]"
          >
            <ArrowRight className="size-3.5" aria-hidden />
            {t(I18nKey.AUTOMATIONS$IMPROVE$UP_NEXT)}
          </span>
        ) : null}
      </div>
    </li>
  );
}

interface ImproveRotationStripProps {
  repositories: ImproveCycleRepository[];
  /** The entry the next run will take; null when the rotation is empty. */
  nextIndex: number | null;
  lastVerdicts: Map<string, ImproveVerdict>;
}

/**
 * The program's repositories in the order its runs work through them, with
 * the one the next run will take marked unmistakably and whatever verdict
 * each repository last earned.
 */
export function ImproveRotationStrip({
  repositories,
  nextIndex,
  lastVerdicts,
}: ImproveRotationStripProps) {
  const { t } = useTranslation("openhands");

  if (repositories.length === 0) {
    return <EmptyRotation />;
  }

  return (
    <section
      data-testid="improve-rotation"
      aria-labelledby="improve-rotation-heading"
      className="flex flex-col gap-3"
    >
      <div>
        <h3
          id="improve-rotation-heading"
          className="text-base font-semibold text-foreground"
        >
          {t(I18nKey.AUTOMATIONS$IMPROVE$ROTATION_TITLE)}
        </h3>
        <p className="mt-1 text-sm text-tertiary-light">
          {t(I18nKey.AUTOMATIONS$IMPROVE$ROTATION_DESCRIPTION)}
        </p>
      </div>
      <ol className="flex flex-col gap-2">
        {repositories.map((repository) => (
          <RotationEntry
            key={`${repository.index}-${repository.url}`}
            repository={repository}
            isUpNext={repository.index === nextIndex}
            lastVerdict={lastVerdicts.get(repository.url)}
          />
        ))}
      </ol>
    </section>
  );
}
