/**
 * The Work view: the project manager's plan as a kanban board.
 *
 * One tab per sprint plus the backlog. The active sprint shows its burndown;
 * a planned sprint can be filled from the backlog up to the team's velocity
 * with one click, and an active one closed with carry-over handled. Cards move
 * between lanes by drag, to another sprint by dropping on its tab, and every
 * card, epic chip and sprint tab has a right-click menu. The board is a view
 * over the same document the canvas draws, so a card's part is a click away.
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { I18nKey } from "#/i18n/declaration";
import {
  WORKBENCH_ROLES,
  WORKBENCH_STAGES,
  type WorkbenchDocument,
  type WorkbenchEpic,
  type WorkbenchSprint,
  type WorkbenchStage,
  type WorkbenchWorkItem,
} from "#/types/workbench";
import { useWorkbenchStore } from "#/stores/workbench-store";
import {
  burndownSeries,
  epicProgress,
  itemsInSprint,
  pointsOf,
  sprintTotals,
} from "#/utils/workbench/workbench-planning";
import { partById } from "#/utils/workbench/workbench-geometry";
import { cn } from "#/utils/utils";
import {
  WORKBENCH_AVATAR_CLASS,
  WORKBENCH_BUTTON_CLASS,
  WORKBENCH_CHIP_CLASS,
  WORKBENCH_DRAG_TYPES,
  WORKBENCH_INPUT_CLASS,
  WORKBENCH_PRIMARY_BUTTON_CLASS,
  WORKBENCH_SECTION_LABEL_CLASS,
  accentBgClass,
  accentBorderClass,
  accentTextClass,
  accentVar,
  focusOnMount,
} from "./workbench-controls";
import type { WorkbenchMenuItem } from "./workbench-context-menu";
import {
  ITEM_TYPE_KEYS,
  ROLE_LABEL_KEYS,
  STAGE_LABEL_KEYS,
  STAGE_OWNER_KEYS,
} from "./workbench-labels";

const BACKLOG_TAB = "__backlog__";
const POINT_CHOICES = [1, 2, 3, 5, 8, 13];

export interface WorkbenchBoardProps {
  document: WorkbenchDocument;
  openMenu: (
    event: React.MouseEvent,
    items: WorkbenchMenuItem[],
    title?: string,
  ) => void;
  showToast: (text: string, canUndo?: boolean) => void;
  /** Focus the chat (as the PM) on a story. */
  onAsk: (itemId: string) => void;
  /** Show a story's part on the canvas. */
  onShowPart: (partId: string) => void;
  /** Hand a story to the team: starts the real work. */
  onStart: (item: WorkbenchWorkItem) => void;
}

export function WorkbenchBoard({
  document: doc,
  openMenu,
  showToast,
  onAsk,
  onShowPart,
  onStart,
}: WorkbenchBoardProps) {
  const { t } = useTranslation("openhands");
  const boardSprintId = useWorkbenchStore((s) => s.boardSprintId);
  const boardEpicId = useWorkbenchStore((s) => s.boardEpicId);
  const selection = useWorkbenchStore((s) => s.selection);
  const {
    setBoardSprint,
    setBoardEpic,
    setSelection,
    moveItemToStage,
    moveItemToSprint,
    addItem,
    renameItem,
    setItemPoints,
    setItemEpic,
    deleteItem,
    splitItem,
    addEpic,
    renameEpic,
    deleteEpic,
    addSprint,
    planSprint,
    startSprint,
    endSprint,
    setSprintGoal,
    deleteSprint,
  } = useWorkbenchStore.getState();

  const [renaming, setRenaming] = React.useState<{
    id: string;
    value: string;
  } | null>(null);
  const [draft, setDraft] = React.useState("");
  const [dragOver, setDragOver] = React.useState<string | null>(null);

  const tab =
    boardSprintId ??
    doc.sprints.find((s) => s.state === "active")?.id ??
    BACKLOG_TAB;
  const sprint = doc.sprints.find((s) => s.id === tab) ?? null;
  const items = itemsInSprint(doc, sprint ? sprint.id : null).filter(
    (item) => boardEpicId === null || item.epicId === boardEpicId,
  );
  const epicOf = (item: WorkbenchWorkItem) =>
    doc.epics.find((e) => e.id === item.epicId) ?? null;
  const roleOf = (item: WorkbenchWorkItem) =>
    WORKBENCH_ROLES.find((r) => r.id === item.role) ?? null;

  const commitRename = () => {
    if (!renaming) return;
    const value = renaming.value.trim();
    if (value !== "") {
      if (renaming.id.startsWith("epic:"))
        renameEpic(renaming.id.slice(5), value);
      else if (renaming.id.startsWith("goal:"))
        setSprintGoal(renaming.id.slice(5), value);
      else renameItem(renaming.id, value);
    }
    setRenaming(null);
  };

  const submitDraft = (event: React.FormEvent) => {
    event.preventDefault();
    const title = draft.trim();
    if (title === "") return;
    const id = addItem({
      title,
      sprintId: sprint ? sprint.id : null,
      epicId: boardEpicId ?? undefined,
    });
    if (id) {
      setDraft("");
      setSelection({ itemId: id });
      showToast(t(I18nKey.WORKBENCH$TOAST_STORY_ADDED, { title }), true);
    }
  };

  // ---- menus ----
  const cardMenu = (event: React.MouseEvent, item: WorkbenchWorkItem) => {
    setSelection({ itemId: item.id });
    openMenu(
      event,
      [
        {
          id: "start",
          label: t(I18nKey.WORKBENCH$MENU_START_STORY),
          disabled: item.stage === "done",
          onSelect: () => onStart(item),
        },
        {
          id: "ask",
          label: t(I18nKey.WORKBENCH$MENU_ASK_PM),
          onSelect: () => onAsk(item.id),
        },
        {
          id: "rename",
          label: t(I18nKey.WORKBENCH$MENU_RENAME),
          hint: "F2",
          onSelect: () => setRenaming({ id: item.id, value: item.title }),
        },
        {
          id: "stage",
          label: t(I18nKey.WORKBENCH$MENU_MOVE_TO_STAGE),
          children: WORKBENCH_STAGES.map((stage) => ({
            id: `stage-${stage}`,
            label: t(STAGE_LABEL_KEYS[stage]),
            checked: item.stage === stage,
            onSelect: () => moveItemToStage(item.id, stage),
          })),
        },
        {
          id: "sprint",
          label: t(I18nKey.WORKBENCH$MENU_MOVE_TO_SPRINT),
          children: [
            {
              id: "sprint-backlog",
              label: t(I18nKey.WORKBENCH$BACKLOG),
              checked: item.sprintId === null,
              onSelect: () => moveItemToSprint(item.id, null),
            },
            ...doc.sprints
              .filter((s) => s.state !== "closed")
              .map((s) => ({
                id: `sprint-${s.id}`,
                label: t(I18nKey.WORKBENCH$SPRINT_NAME, { number: s.number }),
                checked: item.sprintId === s.id,
                onSelect: () => moveItemToSprint(item.id, s.id),
              })),
          ],
        },
        {
          id: "epic",
          label: t(I18nKey.WORKBENCH$MENU_EPIC),
          children: doc.epics.map((e) => ({
            id: `epic-${e.id}`,
            label: e.title,
            checked: item.epicId === e.id,
            onSelect: () => setItemEpic(item.id, e.id),
          })),
        },
        {
          id: "points",
          label: t(I18nKey.WORKBENCH$MENU_POINTS),
          children: POINT_CHOICES.map((n) => ({
            id: `pts-${n}`,
            label: String(n),
            checked: item.points === n,
            onSelect: () => setItemPoints(item.id, n),
          })),
        },
        {
          id: "split",
          label: t(I18nKey.WORKBENCH$MENU_SPLIT),
          disabled: item.points < 2,
          onSelect: () => {
            splitItem(item.id);
            showToast(
              t(I18nKey.WORKBENCH$TOAST_SPLIT, { key: item.key }),
              true,
            );
          },
        },
        ...(item.partId
          ? [
              {
                id: "part",
                label: t(I18nKey.WORKBENCH$MENU_SHOW_PART),
                onSelect: () => onShowPart(item.partId as string),
              },
            ]
          : []),
        {
          id: "delete",
          label: t(I18nKey.WORKBENCH$MENU_DELETE),
          hint: "Del",
          danger: true,
          onSelect: () => {
            deleteItem(item.id);
            showToast(t(I18nKey.WORKBENCH$TOAST_DELETED, { count: 1 }), true);
          },
        },
      ],
      `${item.key} · ${item.title}`,
    );
  };

  const epicMenu = (event: React.MouseEvent, epic: WorkbenchEpic) => {
    openMenu(
      event,
      [
        {
          id: "filter",
          label: t(I18nKey.WORKBENCH$MENU_FILTER_EPIC),
          checked: boardEpicId === epic.id,
          onSelect: () =>
            setBoardEpic(boardEpicId === epic.id ? null : epic.id),
        },
        {
          id: "rename",
          label: t(I18nKey.WORKBENCH$MENU_RENAME),
          onSelect: () =>
            setRenaming({ id: `epic:${epic.id}`, value: epic.title }),
        },
        {
          id: "story",
          label: t(I18nKey.WORKBENCH$MENU_NEW_STORY_IN_EPIC),
          onSelect: () => {
            const id = addItem({
              title: t(I18nKey.WORKBENCH$NEW_STORY_TITLE),
              epicId: epic.id,
              sprintId: sprint ? sprint.id : null,
            });
            if (id) {
              setSelection({ itemId: id });
              setRenaming({ id, value: t(I18nKey.WORKBENCH$NEW_STORY_TITLE) });
            }
          },
        },
        {
          id: "delete",
          label: t(I18nKey.WORKBENCH$MENU_DELETE),
          danger: true,
          disabled: doc.epics.length < 2,
          onSelect: () => {
            deleteEpic(epic.id);
            showToast(
              t(I18nKey.WORKBENCH$TOAST_EPIC_DELETED, { title: epic.title }),
              true,
            );
          },
        },
      ],
      epic.title,
    );
  };

  const sprintMenu = (event: React.MouseEvent, s: WorkbenchSprint) => {
    openMenu(
      event,
      [
        {
          id: "plan",
          label: t(I18nKey.WORKBENCH$PLAN_SPRINT),
          disabled: s.state !== "planned",
          onSelect: () => {
            const n = planSprint(s.id);
            showToast(t(I18nKey.WORKBENCH$TOAST_PLANNED, { count: n }), n > 0);
          },
        },
        {
          id: "start",
          label: t(I18nKey.WORKBENCH$START_SPRINT),
          disabled: s.state !== "planned",
          onSelect: () => startSprint(s.id),
        },
        {
          id: "end",
          label: t(I18nKey.WORKBENCH$END_SPRINT),
          disabled: s.state !== "active",
          onSelect: () => {
            endSprint(s.id);
            showToast(
              t(I18nKey.WORKBENCH$TOAST_SPRINT_ENDED, { number: s.number }),
              true,
            );
          },
        },
        {
          id: "goal",
          label: t(I18nKey.WORKBENCH$MENU_SET_GOAL),
          onSelect: () => {
            setBoardSprint(s.id);
            setRenaming({ id: `goal:${s.id}`, value: s.goal });
          },
        },
        {
          id: "delete",
          label: t(I18nKey.WORKBENCH$MENU_DELETE),
          danger: true,
          disabled: s.state === "active",
          onSelect: () => {
            deleteSprint(s.id);
            showToast(
              t(I18nKey.WORKBENCH$TOAST_SPRINT_DELETED, { number: s.number }),
              true,
            );
          },
        },
      ],
      t(I18nKey.WORKBENCH$SPRINT_NAME, { number: s.number }),
    );
  };

  // ---- drag ----
  const onCardDragStart = (event: React.DragEvent, item: WorkbenchWorkItem) => {
    const { dataTransfer } = event;
    dataTransfer.setData(WORKBENCH_DRAG_TYPES.item, item.id);
    dataTransfer.effectAllowed = "move";
    setSelection({ itemId: item.id });
  };
  const acceptsItem = (event: React.DragEvent) =>
    event.dataTransfer.types.includes(WORKBENCH_DRAG_TYPES.item);
  const dropOnLane = (event: React.DragEvent, stage: WorkbenchStage) => {
    if (!acceptsItem(event)) return;
    event.preventDefault();
    const id = event.dataTransfer.getData(WORKBENCH_DRAG_TYPES.item);
    const item = doc.work.find((w) => w.id === id);
    setDragOver(null);
    if (!item || item.stage === stage) return;
    moveItemToStage(id, stage);
    showToast(
      t(I18nKey.WORKBENCH$TOAST_MOVED_TO_STAGE, {
        key: item.key,
        stage: t(STAGE_LABEL_KEYS[stage]),
      }),
      true,
    );
  };
  const dropOnTab = (event: React.DragEvent, sprintId: string | null) => {
    if (!acceptsItem(event)) return;
    event.preventDefault();
    const id = event.dataTransfer.getData(WORKBENCH_DRAG_TYPES.item);
    const item = doc.work.find((w) => w.id === id);
    setDragOver(null);
    if (!item || item.sprintId === sprintId) return;
    moveItemToSprint(id, sprintId);
    showToast(
      sprintId
        ? t(I18nKey.WORKBENCH$TOAST_MOVED_TO_SPRINT, {
            key: item.key,
            number: doc.sprints.find((s) => s.id === sprintId)?.number ?? 0,
          })
        : t(I18nKey.WORKBENCH$TOAST_MOVED_TO_BACKLOG, { key: item.key }),
      true,
    );
  };

  const tabClass = (active: boolean, over: boolean) =>
    cn(
      "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
      active
        ? "border-primary bg-interactive-selected text-foreground"
        : "border-border-subtle bg-surface text-text-secondary hover:bg-interactive-hover",
      over && "ring-2 ring-primary",
    );

  return (
    <div
      data-testid="workbench-board"
      className="flex h-full flex-col gap-3 overflow-hidden bg-canvas-base p-3"
    >
      <div className="sticky top-0 z-10 flex flex-col gap-2">
        <div
          role="tablist"
          aria-label={t(I18nKey.WORKBENCH$SPRINTS)}
          className="flex flex-wrap items-center gap-1.5"
        >
          {doc.sprints.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={tab === s.id}
              data-testid={`workbench-sprint-tab-${s.id}`}
              data-tip={s.goal || s.dates}
              className={tabClass(tab === s.id, dragOver === `tab:${s.id}`)}
              onClick={() => setBoardSprint(s.id)}
              onContextMenu={(event) => sprintMenu(event, s)}
              onDragOver={(event) => {
                if (acceptsItem(event)) {
                  event.preventDefault();
                  setDragOver(`tab:${s.id}`);
                }
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(event) => dropOnTab(event, s.id)}
            >
              {t(I18nKey.WORKBENCH$SPRINT_NAME, { number: s.number })}
              <span className="ml-1 text-micro text-muted">
                {s.state === "active"
                  ? t(I18nKey.WORKBENCH$SPRINT_ACTIVE)
                  : s.state === "closed"
                    ? t(I18nKey.WORKBENCH$SPRINT_CLOSED)
                    : t(I18nKey.WORKBENCH$SPRINT_PLANNED)}
              </span>
            </button>
          ))}
          <button
            type="button"
            role="tab"
            aria-selected={tab === BACKLOG_TAB}
            data-testid="workbench-backlog-tab"
            className={tabClass(
              tab === BACKLOG_TAB,
              dragOver === "tab:backlog",
            )}
            onClick={() => setBoardSprint(BACKLOG_TAB)}
            onDragOver={(event) => {
              if (acceptsItem(event)) {
                event.preventDefault();
                setDragOver("tab:backlog");
              }
            }}
            onDragLeave={() => setDragOver(null)}
            onDrop={(event) => dropOnTab(event, null)}
          >
            {t(I18nKey.WORKBENCH$BACKLOG)}
            <span className="ml-1 text-micro text-muted">
              {pointsOf(itemsInSprint(doc, null))}
            </span>
          </button>
          <button
            type="button"
            data-testid="workbench-new-sprint"
            className={WORKBENCH_BUTTON_CLASS}
            onClick={() => setBoardSprint(addSprint())}
          >
            <Plus size={12} aria-hidden />
            {t(I18nKey.WORKBENCH$NEW_SPRINT)}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className={cn(WORKBENCH_SECTION_LABEL_CLASS, "mr-1")}>
            {t(I18nKey.WORKBENCH$EPICS)}
          </span>
          {doc.epics.map((epic) => (
            <button
              key={epic.id}
              type="button"
              data-testid={`workbench-epic-${epic.id}`}
              aria-pressed={boardEpicId === epic.id}
              data-tip={epic.goal}
              className={cn(
                WORKBENCH_CHIP_CLASS,
                "border-l-4",
                accentBorderClass(epic.accent),
                boardEpicId === epic.id && "bg-interactive-selected",
              )}
              onClick={() =>
                setBoardEpic(boardEpicId === epic.id ? null : epic.id)
              }
              onContextMenu={(event) => epicMenu(event, epic)}
            >
              {renaming?.id === `epic:${epic.id}` ? (
                <input
                  ref={focusOnMount}
                  aria-label={t(I18nKey.WORKBENCH$MENU_RENAME)}
                  className="w-28 bg-transparent outline-none"
                  value={renaming.value}
                  onChange={(e) =>
                    setRenaming({ ...renaming, value: e.target.value })
                  }
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") setRenaming(null);
                  }}
                />
              ) : (
                <>
                  <span className="font-mono text-micro text-muted">
                    {epic.key}
                  </span>
                  <span className="truncate">{epic.title}</span>
                  <span
                    className={cn(
                      "text-micro font-semibold",
                      accentTextClass(epic.accent),
                    )}
                  >
                    {epicProgress(doc, epic.id)}%
                  </span>
                </>
              )}
            </button>
          ))}
          <button
            type="button"
            data-testid="workbench-new-epic"
            className={WORKBENCH_BUTTON_CLASS}
            onClick={() => {
              const key = `EP${doc.epics.length + 1}`;
              const id = addEpic(t(I18nKey.WORKBENCH$NEW_EPIC_TITLE), key);
              setRenaming({
                id: `epic:${id}`,
                value: t(I18nKey.WORKBENCH$NEW_EPIC_TITLE),
              });
            }}
          >
            <Plus size={12} aria-hidden />
            {t(I18nKey.WORKBENCH$NEW_EPIC)}
          </button>
        </div>

        {sprint && (
          <SprintHeader
            document={doc}
            sprint={sprint}
            renaming={renaming}
            setRenaming={setRenaming}
            commitRename={commitRename}
            onPlan={() => {
              const n = planSprint(sprint.id);
              showToast(
                t(I18nKey.WORKBENCH$TOAST_PLANNED, { count: n }),
                n > 0,
              );
            }}
            onStart={() => startSprint(sprint.id)}
            onEnd={() => {
              endSprint(sprint.id);
              showToast(
                t(I18nKey.WORKBENCH$TOAST_SPRINT_ENDED, {
                  number: sprint.number,
                }),
                true,
              );
            }}
          />
        )}
      </div>

      <form className="flex gap-2" onSubmit={submitDraft}>
        <input
          data-testid="workbench-new-story"
          className={WORKBENCH_INPUT_CLASS}
          placeholder={
            sprint
              ? t(I18nKey.WORKBENCH$NEW_STORY_PLACEHOLDER_SPRINT, {
                  number: sprint.number,
                })
              : t(I18nKey.WORKBENCH$NEW_STORY_PLACEHOLDER_BACKLOG)
          }
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button
          type="submit"
          className={WORKBENCH_PRIMARY_BUTTON_CLASS}
          disabled={draft.trim() === ""}
        >
          {t(I18nKey.WORKBENCH$ADD)}
        </button>
      </form>

      {sprint ? (
        <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto custom-scrollbar">
          {WORKBENCH_STAGES.map((stage) => {
            const lane = items.filter((item) => item.stage === stage);
            return (
              <section
                key={stage}
                data-testid={`workbench-lane-${stage}`}
                aria-label={t(STAGE_LABEL_KEYS[stage])}
                className={cn(
                  "flex min-h-0 w-44 shrink-0 grow basis-44 flex-col gap-2 rounded-lg border border-border-subtle bg-base-secondary p-2",
                  dragOver === `lane:${stage}` && "ring-2 ring-primary",
                )}
                onDragOver={(event) => {
                  if (acceptsItem(event)) {
                    event.preventDefault();
                    const { dataTransfer } = event;
                    dataTransfer.dropEffect = "move";
                    setDragOver(`lane:${stage}`);
                  }
                }}
                onDragLeave={() => setDragOver(null)}
                onDrop={(event) => dropOnLane(event, stage)}
              >
                <header className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-semibold text-foreground">
                    {t(STAGE_LABEL_KEYS[stage])}
                  </span>
                  <span
                    className="text-micro text-muted"
                    data-tip={t(STAGE_OWNER_KEYS[stage])}
                  >
                    {pointsOf(lane)} {t(I18nKey.WORKBENCH$POINTS_SHORT)}
                  </span>
                </header>
                <div className="flex min-h-12 flex-1 flex-col gap-2 overflow-y-auto custom-scrollbar">
                  {lane.map((item) => (
                    <StoryCard
                      key={item.id}
                      item={item}
                      epic={epicOf(item)}
                      role={roleOf(item)}
                      document={doc}
                      selected={selection.itemId === item.id}
                      renaming={
                        renaming?.id === item.id ? renaming.value : null
                      }
                      onRenameChange={(value) =>
                        setRenaming({ id: item.id, value })
                      }
                      onRenameCommit={commitRename}
                      onRenameCancel={() => setRenaming(null)}
                      onSelect={() => setSelection({ itemId: item.id })}
                      onOpenRename={() =>
                        setRenaming({ id: item.id, value: item.title })
                      }
                      onMenu={(event) => cardMenu(event, item)}
                      onDragStart={(event) => onCardDragStart(event, item)}
                      onShowPart={onShowPart}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto custom-scrollbar">
          {doc.epics
            .filter((epic) => boardEpicId === null || epic.id === boardEpicId)
            .map((epic) => {
              const list = items.filter((item) => item.epicId === epic.id);
              return (
                <section
                  key={epic.id}
                  className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-base-secondary p-2"
                  onContextMenu={(event) => epicMenu(event, epic)}
                >
                  <header className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-xs font-semibold text-foreground">
                      <span
                        className={cn(
                          "h-2.5 w-2.5 rounded-full",
                          accentBgClass(epic.accent),
                        )}
                        aria-hidden
                      />
                      {epic.title}
                      <span className="font-normal text-muted">
                        {epic.goal}
                      </span>
                    </span>
                    <span className="text-micro text-muted">
                      {t(I18nKey.WORKBENCH$BACKLOG_POINTS, {
                        count: pointsOf(list),
                      })}
                    </span>
                  </header>
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {list.length === 0 && (
                      <p className="text-xs text-muted">
                        {t(I18nKey.WORKBENCH$BACKLOG_EMPTY)}
                      </p>
                    )}
                    {list.map((item) => (
                      <StoryCard
                        key={item.id}
                        item={item}
                        epic={epic}
                        role={roleOf(item)}
                        document={doc}
                        selected={selection.itemId === item.id}
                        renaming={
                          renaming?.id === item.id ? renaming.value : null
                        }
                        onRenameChange={(value) =>
                          setRenaming({ id: item.id, value })
                        }
                        onRenameCommit={commitRename}
                        onRenameCancel={() => setRenaming(null)}
                        onSelect={() => setSelection({ itemId: item.id })}
                        onOpenRename={() =>
                          setRenaming({ id: item.id, value: item.title })
                        }
                        onMenu={(event) => cardMenu(event, item)}
                        onDragStart={(event) => onCardDragStart(event, item)}
                        onShowPart={onShowPart}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
        </div>
      )}
    </div>
  );
}

function SprintHeader({
  document: doc,
  sprint,
  renaming,
  setRenaming,
  commitRename,
  onPlan,
  onStart,
  onEnd,
}: {
  document: WorkbenchDocument;
  sprint: WorkbenchSprint;
  renaming: { id: string; value: string } | null;
  setRenaming: (next: { id: string; value: string } | null) => void;
  commitRename: () => void;
  onPlan: () => void;
  onStart: () => void;
  onEnd: () => void;
}) {
  const { t } = useTranslation("openhands");
  const totals = sprintTotals(doc, sprint.id);
  const editingGoal = renaming?.id === `goal:${sprint.id}`;
  return (
    <div
      data-testid="workbench-sprint-header"
      className="flex flex-wrap items-center gap-3 rounded-lg border border-border-subtle bg-base-secondary px-3 py-2"
    >
      <div className="flex min-w-48 flex-1 flex-col">
        <span className="whitespace-nowrap text-micro uppercase tracking-widest text-muted">
          {sprint.dates || t(I18nKey.WORKBENCH$SPRINT_NO_DATES)}
        </span>
        {editingGoal ? (
          <input
            ref={focusOnMount}
            data-testid="workbench-sprint-goal-input"
            aria-label={t(I18nKey.WORKBENCH$MENU_SET_GOAL)}
            className={WORKBENCH_INPUT_CLASS}
            value={renaming.value}
            onChange={(e) =>
              setRenaming({ id: renaming.id, value: e.target.value })
            }
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setRenaming(null);
            }}
          />
        ) : (
          <button
            type="button"
            className="line-clamp-2 text-left text-sm font-semibold text-foreground hover:underline"
            data-tip={t(I18nKey.WORKBENCH$MENU_SET_GOAL)}
            onClick={() =>
              setRenaming({ id: `goal:${sprint.id}`, value: sprint.goal })
            }
          >
            {sprint.goal || t(I18nKey.WORKBENCH$SPRINT_NO_GOAL)}
          </button>
        )}
        {sprint.review && (
          <span className="text-xs text-text-secondary">{sprint.review}</span>
        )}
      </div>
      <div className="flex items-center gap-3 text-xs text-text-secondary">
        <span data-testid="workbench-sprint-totals">
          {t(I18nKey.WORKBENCH$SPRINT_TOTALS, {
            done: totals.done,
            total: totals.total,
          })}
        </span>
        <span>{t(I18nKey.WORKBENCH$VELOCITY, { count: doc.velocity })}</span>
        {sprint.state !== "planned" && <Burndown sprint={sprint} />}
      </div>
      <div className="flex items-center gap-1.5">
        {sprint.state === "planned" && (
          <>
            <button
              type="button"
              data-testid="workbench-plan-sprint"
              className={WORKBENCH_PRIMARY_BUTTON_CLASS}
              onClick={onPlan}
            >
              {t(I18nKey.WORKBENCH$PLAN_SPRINT)}
            </button>
            <button
              type="button"
              data-testid="workbench-start-sprint"
              className={WORKBENCH_BUTTON_CLASS}
              onClick={onStart}
            >
              {t(I18nKey.WORKBENCH$START_SPRINT)}
            </button>
          </>
        )}
        {sprint.state === "active" && (
          <button
            type="button"
            data-testid="workbench-end-sprint"
            className={WORKBENCH_BUTTON_CLASS}
            onClick={onEnd}
          >
            {t(I18nKey.WORKBENCH$END_SPRINT)}
          </button>
        )}
      </div>
    </div>
  );
}

function Burndown({ sprint }: { sprint: WorkbenchSprint }) {
  const { t } = useTranslation("openhands");
  const { actual, guide } = burndownSeries(sprint);
  const w = 120;
  const h = 36;
  const px = (day: number) => (day / Math.max(1, sprint.days)) * (w - 2) + 1;
  const py = (frac: number) => h - 2 - frac * (h - 4);
  const line = (series: number[]) =>
    series.map((frac, day) => `${px(day)},${py(frac)}`).join(" ");
  return (
    <svg
      width={w}
      height={h}
      role="img"
      aria-label={t(I18nKey.WORKBENCH$BURNDOWN)}
      data-tip={t(I18nKey.WORKBENCH$BURNDOWN)}
      className="shrink-0"
    >
      <polyline
        points={line(guide)}
        fill="none"
        className="stroke-border"
        strokeDasharray="2 3"
      />
      <polyline
        points={line(actual)}
        fill="none"
        stroke={accentVar(1)}
        strokeWidth={2}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StoryCard({
  item,
  epic,
  role,
  document: doc,
  selected,
  renaming,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  onSelect,
  onOpenRename,
  onMenu,
  onDragStart,
  onShowPart,
}: {
  item: WorkbenchWorkItem;
  epic: WorkbenchEpic | null;
  role: (typeof WORKBENCH_ROLES)[number] | null;
  document: WorkbenchDocument;
  selected: boolean;
  renaming: string | null;
  onRenameChange: (value: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  onSelect: () => void;
  onOpenRename: () => void;
  onMenu: (event: React.MouseEvent) => void;
  onDragStart: (event: React.DragEvent) => void;
  onShowPart: (partId: string) => void;
}) {
  const { t } = useTranslation("openhands");
  const part = item.partId ? partById(doc, item.partId) : null;
  return (
    <div
      data-testid={`workbench-card-${item.id}`}
      role="button"
      draggable
      tabIndex={0}
      aria-pressed={selected}
      className={cn(
        "flex min-w-0 cursor-grab flex-col gap-1.5 break-words rounded-md border bg-surface-raised p-2 text-xs outline-none focus-visible:outline-2 focus-visible:outline-focus",
        selected ? "border-primary" : "border-border-subtle",
        epic && "border-l-4",
        epic && accentBorderClass(epic.accent),
      )}
      onClick={onSelect}
      onDoubleClick={onOpenRename}
      onKeyDown={(event) => {
        if (event.key === "F2") {
          event.preventDefault();
          onOpenRename();
        }
        if (event.key === "Enter") onSelect();
      }}
      onContextMenu={onMenu}
      onDragStart={onDragStart}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-micro text-muted">{item.key}</span>
        <span className="flex items-center gap-1 text-micro text-muted">
          <span>{t(ITEM_TYPE_KEYS[item.type])}</span>
          <span className="rounded bg-interactive-hover px-1 font-semibold text-foreground">
            {item.points}
          </span>
        </span>
      </div>
      {renaming !== null ? (
        <input
          ref={focusOnMount}
          data-testid={`workbench-card-rename-${item.id}`}
          aria-label={t(I18nKey.WORKBENCH$MENU_RENAME)}
          className={WORKBENCH_INPUT_CLASS}
          value={renaming}
          onChange={(e) => onRenameChange(e.target.value)}
          onBlur={onRenameCommit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") onRenameCommit();
            if (e.key === "Escape") onRenameCancel();
          }}
        />
      ) : (
        <span className="font-medium text-foreground">{item.title}</span>
      )}
      {item.blocked && (
        <span className="rounded bg-warning/15 px-1.5 py-0.5 text-micro font-semibold text-warning">
          {item.blocked}
        </span>
      )}
      {item.note && !item.blocked && (
        <span className="text-micro text-text-secondary">{item.note}</span>
      )}
      {typeof item.percent === "number" && item.stage !== "done" && (
        <div
          className="h-1 w-full overflow-hidden rounded bg-interactive-hover"
          role="progressbar"
          aria-valuenow={item.percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full bg-primary"
            style={{ width: `${item.percent}%` }}
          />
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {role && (
            <span
              className={cn(
                WORKBENCH_AVATAR_CLASS,
                "h-5 w-5 text-[8px]",
                accentBgClass(role.accent),
              )}
              data-tip={t(ROLE_LABEL_KEYS[role.id])}
            >
              {role.initials}
            </span>
          )}
          {part && (
            <button
              type="button"
              className="truncate rounded border border-border-subtle px-1 text-micro text-text-secondary hover:bg-interactive-hover"
              data-tip={t(I18nKey.WORKBENCH$MENU_SHOW_PART)}
              onClick={(event) => {
                event.stopPropagation();
                onShowPart(part.id);
              }}
            >
              {part.name}
            </button>
          )}
        </div>
        {item.pr && (
          <span className="font-mono text-micro text-muted">#{item.pr}</span>
        )}
      </div>
    </div>
  );
}
