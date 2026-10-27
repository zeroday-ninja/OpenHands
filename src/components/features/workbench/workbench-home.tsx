/**
 * `/workbench`: the projects in this workspace, and the way to a new one.
 *
 * A project is a name and a set of repos. Opening one goes to its canvas;
 * picking repos that have no map yet means the first thing that canvas does
 * is ask the Architect to crawl them. A workspace with no document at all can
 * start from the example, which is also what mock mode shows.
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { FolderGit2, Plus } from "lucide-react";
import { I18nKey } from "#/i18n/declaration";
import { NavigationLink } from "#/components/shared/navigation-link";
import { useNavigation } from "#/context/navigation-context";
import { useSaveWorkbench } from "#/hooks/mutation/use-save-workbench";
import { useWorkbench } from "#/hooks/query/use-workbench";
import { useWorkbenchStore } from "#/stores/workbench-store";
import {
  WORKBENCH_ROUTE_PATH,
  emptyWorkbenchDocument,
  type WorkbenchDocument,
} from "#/types/workbench";
import { workbenchExampleDocument } from "#/utils/workbench/workbench-seed";
import { cn } from "#/utils/utils";
import {
  WORKBENCH_BUTTON_CLASS,
  WORKBENCH_INPUT_CLASS,
  WORKBENCH_PRIMARY_BUTTON_CLASS,
  WORKBENCH_SECTION_LABEL_CLASS,
  accentBgClass,
} from "./workbench-controls";

export function WorkbenchHome() {
  const { t } = useTranslation("openhands");
  const { data, isLoading, unsupportedReason, error } = useWorkbench(null);
  const doc = useWorkbenchStore((s) => s.document);
  const hydrate = useWorkbenchStore((s) => s.hydrate);

  React.useEffect(() => {
    if (!data?.document) return;
    hydrate(data.revision, data.document);
  }, [data, hydrate]);

  if (unsupportedReason !== null)
    return <WorkbenchEmptyState kind={unsupportedReason} />;
  if (isLoading && !doc)
    return (
      <div
        data-testid="workbench-loading"
        className="flex h-full items-center justify-center text-sm text-muted"
      >
        {t(I18nKey.WORKBENCH$LOADING)}
      </div>
    );
  if (error)
    return (
      <WorkbenchEmptyState
        kind="error"
        detail={error instanceof Error ? error.message : String(error)}
      />
    );
  if (data?.failure)
    return <WorkbenchEmptyState kind="error" detail={data.failure} />;
  if (!doc) return <WorkbenchEmptyState kind="missing" conversationId={null} />;

  return <ProjectList document={doc} />;
}

function ProjectList({ document: doc }: { document: WorkbenchDocument }) {
  const { t } = useTranslation("openhands");
  const { navigate } = useNavigation();
  const addProject = useWorkbenchStore((s) => s.addProject);
  const dirty = useWorkbenchStore((s) => s.dirty);
  const save = useSaveWorkbench(null);
  const markSaved = useWorkbenchStore((s) => s.markSaved);
  const current = useWorkbenchStore((s) => s.document);
  const [name, setName] = React.useState("");
  const [picked, setPicked] = React.useState<string[]>([]);

  React.useEffect(() => {
    if (!dirty || !current) return undefined;
    const timer = setTimeout(
      () => save.mutate(current, { onSuccess: () => markSaved() }),
      600,
    );
    return () => clearTimeout(timer);
  }, [dirty, current]);

  const create = (event: React.FormEvent) => {
    event.preventDefault();
    const title = name.trim();
    if (title === "" || picked.length === 0) return;
    const id = addProject(title, picked);
    navigate(`${WORKBENCH_ROUTE_PATH}/${id}`);
  };

  return (
    <div
      data-testid="workbench-home"
      className="flex h-full flex-col gap-6 overflow-y-auto bg-canvas-base p-6 text-canvas-base custom-scrollbar"
    >
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold text-foreground">
          {t(I18nKey.WORKBENCH$TITLE)}
        </h1>
        <p className="text-sm text-text-secondary">
          {t(I18nKey.WORKBENCH$SUBTITLE)}
        </p>
      </header>

      <section className="flex flex-col gap-2">
        <span className={WORKBENCH_SECTION_LABEL_CLASS}>
          {t(I18nKey.WORKBENCH$PROJECTS)}
        </span>
        {doc.projects.length === 0 && (
          <p className="text-sm text-muted">
            {t(I18nKey.WORKBENCH$NO_PROJECTS)}
          </p>
        )}
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {doc.projects.map((project) => {
            const repos = doc.repos.filter((repo) =>
              project.repoIds.includes(repo.id),
            );
            const parts = doc.parts.filter((part) =>
              project.repoIds.includes(part.repoId),
            ).length;
            const open = doc.work.filter((w) => w.stage !== "done").length;
            return (
              <li key={project.id}>
                <NavigationLink
                  to={`${WORKBENCH_ROUTE_PATH}/${project.id}`}
                  data-testid={`workbench-project-${project.id}`}
                  className="flex h-full flex-col gap-2 rounded-lg border border-border-subtle bg-base-secondary p-4 transition-colors hover:bg-interactive-hover"
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <FolderGit2 size={14} aria-hidden />
                    {project.name}
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    {repos.map((repo) => (
                      <span
                        key={repo.id}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle bg-surface px-2 py-0.5 text-xs text-foreground"
                      >
                        <span
                          aria-hidden
                          className={cn(
                            "h-2 w-2 rounded-full",
                            accentBgClass(repo.accent),
                          )}
                        />
                        {repo.name}
                      </span>
                    ))}
                  </span>
                  <span className="text-xs text-muted">
                    {t(I18nKey.WORKBENCH$PROJECT_SUMMARY, { parts, open })}
                  </span>
                </NavigationLink>
              </li>
            );
          })}
        </ul>
      </section>

      <form
        className="flex max-w-xl flex-col gap-3 rounded-lg border border-border-subtle bg-base-secondary p-4"
        onSubmit={create}
      >
        <span className={WORKBENCH_SECTION_LABEL_CLASS}>
          {t(I18nKey.WORKBENCH$NEW_PROJECT)}
        </span>
        <input
          data-testid="workbench-new-project-name"
          className={WORKBENCH_INPUT_CLASS}
          placeholder={t(I18nKey.WORKBENCH$NEW_PROJECT_NAME)}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <div
          className="flex flex-wrap gap-1.5"
          role="group"
          aria-label={t(I18nKey.WORKBENCH$PICK_REPOS)}
        >
          {doc.repos.map((repo) => {
            const on = picked.includes(repo.id);
            return (
              <button
                key={repo.id}
                type="button"
                data-testid={`workbench-pick-repo-${repo.id}`}
                aria-pressed={on}
                className={cn(
                  WORKBENCH_BUTTON_CLASS,
                  on && "border-primary bg-interactive-selected",
                )}
                onClick={() =>
                  setPicked(
                    on
                      ? picked.filter((id) => id !== repo.id)
                      : [...picked, repo.id],
                  )
                }
              >
                <span
                  aria-hidden
                  className={cn(
                    "h-2 w-2 rounded-full",
                    accentBgClass(repo.accent),
                  )}
                />
                {repo.name}
                {!repo.hasMap && (
                  <span className="text-micro text-muted">
                    {t(I18nKey.WORKBENCH$NO_MAP_SHORT)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <p className="text-micro text-muted">
          {t(I18nKey.WORKBENCH$NEW_PROJECT_HINT)}
        </p>
        <button
          type="submit"
          data-testid="workbench-create-project"
          className={cn(WORKBENCH_PRIMARY_BUTTON_CLASS, "self-start")}
          disabled={name.trim() === "" || picked.length === 0}
        >
          <Plus size={12} aria-hidden />
          {t(I18nKey.WORKBENCH$CREATE_PROJECT)}
        </button>
      </form>
    </div>
  );
}

export type WorkbenchEmptyKind =
  | "no-backend"
  | "cloud-backend"
  | "missing"
  | "no-project"
  | "error";

const EMPTY_KEYS: Record<WorkbenchEmptyKind, I18nKey> = {
  "no-backend": I18nKey.WORKBENCH$EMPTY_NO_BACKEND,
  "cloud-backend": I18nKey.WORKBENCH$EMPTY_CLOUD,
  missing: I18nKey.WORKBENCH$EMPTY_MISSING,
  "no-project": I18nKey.WORKBENCH$EMPTY_NO_PROJECT,
  error: I18nKey.WORKBENCH$EMPTY_ERROR,
};

export function WorkbenchEmptyState({
  kind,
  detail,
  conversationId = null,
}: {
  kind: WorkbenchEmptyKind;
  detail?: string;
  conversationId?: string | null;
}) {
  const { t } = useTranslation("openhands");
  const save = useSaveWorkbench(conversationId);

  const startFrom = (document: WorkbenchDocument) => save.mutate(document);

  return (
    <div
      data-testid={`workbench-empty-${kind}`}
      className="flex h-full flex-col items-center justify-center gap-4 bg-canvas-base p-8 text-center text-canvas-base"
    >
      <h1 className="text-lg font-semibold text-foreground">
        {t(I18nKey.WORKBENCH$TITLE)}
      </h1>
      <p className="max-w-md text-sm text-text-secondary">
        {t(EMPTY_KEYS[kind])}
      </p>
      {detail && (
        <pre className="max-w-lg whitespace-pre-wrap rounded-md border border-border-subtle bg-surface p-2 text-left font-mono text-micro text-muted">
          {detail}
        </pre>
      )}
      {kind === "missing" && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            data-testid="workbench-start-example"
            className={WORKBENCH_PRIMARY_BUTTON_CLASS}
            disabled={save.isPending}
            onClick={() => startFrom(workbenchExampleDocument())}
          >
            {t(I18nKey.WORKBENCH$START_EXAMPLE)}
          </button>
          <button
            type="button"
            data-testid="workbench-start-blank"
            className={WORKBENCH_BUTTON_CLASS}
            disabled={save.isPending}
            onClick={() => startFrom(emptyWorkbenchDocument())}
          >
            {t(I18nKey.WORKBENCH$START_BLANK)}
          </button>
        </div>
      )}
      {kind === "no-project" && (
        <NavigationLink
          to={WORKBENCH_ROUTE_PATH}
          className={WORKBENCH_BUTTON_CLASS}
        >
          {t(I18nKey.WORKBENCH$ALL_PROJECTS)}
        </NavigationLink>
      )}
    </div>
  );
}
