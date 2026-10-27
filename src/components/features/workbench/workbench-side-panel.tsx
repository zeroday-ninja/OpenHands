/**
 * The left drawer: the team and what it is doing, the library of parts, and
 * the other repos — all of them things you drag onto the canvas.
 *
 * Closed, the drawer becomes an icon rail that keeps the same things reachable
 * at a glance: hover one for what it is, click one to select or talk about it,
 * or drag it straight onto the map without opening the panel first.
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { I18nKey } from "#/i18n/declaration";
import {
  WORKBENCH_KIND_BADGES,
  WORKBENCH_PART_KINDS,
  WORKBENCH_ROLES,
  type WorkbenchAgent,
  type WorkbenchDocument,
  type WorkbenchPartKind,
  type WorkbenchProject,
  type WorkbenchRepo,
  type WorkbenchRole,
} from "#/types/workbench";
import { useWorkbenchStore } from "#/stores/workbench-store";
import { useWorkbenchLayoutStore } from "#/stores/workbench-layout-store";
import { cn } from "#/utils/utils";
import {
  WORKBENCH_AVATAR_CLASS,
  WORKBENCH_DRAG_TYPES,
  WORKBENCH_ICON_BUTTON_CLASS,
  WORKBENCH_PANEL_CLASS,
  WORKBENCH_SECTION_LABEL_CLASS,
  accentBgClass,
  accentBorderClass,
} from "./workbench-controls";
import type { WorkbenchMenuItem } from "./workbench-context-menu";
import {
  AGENT_STATE_KEYS,
  KIND_LABEL_KEYS,
  ROLE_BLURB_KEYS,
  ROLE_LABEL_KEYS,
} from "./workbench-labels";

export interface WorkbenchSidePanelProps {
  document: WorkbenchDocument;
  project: WorkbenchProject;
  openMenu: (
    event: React.MouseEvent,
    items: WorkbenchMenuItem[],
    title?: string,
  ) => void;
  /** Open the chat with a role (Architect or PM) or about an agent. */
  onTalkTo: (role: WorkbenchRole, agent: WorkbenchAgent | null) => void;
  /** Add a repo to the project without dragging. */
  onAddRepo: (repo: WorkbenchRepo) => void;
  onCrawl: (repo: WorkbenchRepo) => void;
}

const STATE_DOT: Record<WorkbenchAgent["state"], string> = {
  running: "bg-success",
  waiting: "bg-warning",
  scheduled: "bg-accent",
  idle: "bg-muted",
};

export function WorkbenchSidePanel({
  document: doc,
  project,
  openMenu,
  onTalkTo,
  onAddRepo,
  onCrawl,
}: WorkbenchSidePanelProps) {
  const { t } = useTranslation("openhands");
  const open = useWorkbenchLayoutStore((s) => s.leftOpen);
  const toggle = useWorkbenchLayoutStore((s) => s.toggleLeft);
  const setSelection = useWorkbenchStore((s) => s.setSelection);
  const setHoverAgent = useWorkbenchStore((s) => s.setHoverAgent);
  const setMode = useWorkbenchStore((s) => s.setMode);

  const partIds = new Set(
    doc.parts
      .filter((p) => project.repoIds.includes(p.repoId))
      .map((p) => p.id),
  );
  const agents = doc.agents.filter((a) =>
    a.focus ? partIds.has(a.focus) : a.targets.some((id) => partIds.has(id)),
  );
  const teamAgents = agents.filter(
    (a) => a.state === "running" || a.state === "waiting",
  );
  const scheduled = agents.filter(
    (a) => a.state === "scheduled" || a.state === "idle",
  );
  const otherRepos = doc.repos.filter(
    (repo) => !project.repoIds.includes(repo.id),
  );
  const agentFor = (role: WorkbenchRole) =>
    teamAgents.find((a) => a.role === role.id) ?? null;

  const focusAgent = (agent: WorkbenchAgent) => {
    const ids = agent.focus ? [agent.focus] : agent.targets;
    setMode("design");
    setSelection({ partIds: ids });
  };

  const dragAgent = (
    event: React.DragEvent,
    agent: WorkbenchAgent | null,
    role: WorkbenchRole,
  ) => {
    const { dataTransfer } = event;
    dataTransfer.setData(
      WORKBENCH_DRAG_TYPES.agent,
      agent?.id ?? `role:${role.id}`,
    );
    dataTransfer.effectAllowed = "move";
  };
  const dragKind = (event: React.DragEvent, kind: WorkbenchPartKind) => {
    const { dataTransfer } = event;
    dataTransfer.setData(WORKBENCH_DRAG_TYPES.libraryPart, kind);
    dataTransfer.effectAllowed = "copy";
  };
  const dragRepo = (event: React.DragEvent, repo: WorkbenchRepo) => {
    const { dataTransfer } = event;
    dataTransfer.setData(WORKBENCH_DRAG_TYPES.repo, repo.id);
    dataTransfer.effectAllowed = "copy";
  };

  const roleMenu = (
    event: React.MouseEvent,
    role: WorkbenchRole,
    agent: WorkbenchAgent | null,
  ) => {
    openMenu(
      event,
      [
        {
          id: "talk",
          label: t(I18nKey.WORKBENCH$MENU_TALK_TO, {
            name: t(ROLE_LABEL_KEYS[role.id]),
          }),
          onSelect: () => onTalkTo(role, agent),
        },
        ...(agent
          ? [
              {
                id: "focus",
                label: t(I18nKey.WORKBENCH$MENU_SHOW_FOCUS),
                onSelect: () => focusAgent(agent),
              },
            ]
          : []),
      ],
      t(ROLE_LABEL_KEYS[role.id]),
    );
  };
  const repoMenu = (event: React.MouseEvent, repo: WorkbenchRepo) => {
    openMenu(
      event,
      [
        {
          id: "add",
          label: t(I18nKey.WORKBENCH$MENU_ADD_TO_PROJECT),
          onSelect: () => onAddRepo(repo),
        },
        {
          id: "crawl",
          label: t(I18nKey.WORKBENCH$MENU_CRAWL),
          onSelect: () => {
            onAddRepo(repo);
            onCrawl(repo);
          },
        },
      ],
      repo.name,
    );
  };

  const avatar = (
    role: WorkbenchRole,
    agent: WorkbenchAgent | null,
    small = false,
  ) => (
    <span className="relative inline-flex">
      <span
        className={cn(
          WORKBENCH_AVATAR_CLASS,
          accentBgClass(role.accent),
          small && "h-6 w-6 text-[9px]",
        )}
      >
        {role.initials}
      </span>
      {agent && (
        <span
          aria-hidden
          className={cn(
            "absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-base-secondary",
            STATE_DOT[agent.state],
            agent.state === "running" && "animate-pulse",
          )}
        />
      )}
    </span>
  );

  if (!open) {
    return (
      <aside
        data-testid="workbench-left-rail"
        aria-label={t(I18nKey.WORKBENCH$LEFT_PANEL)}
        className="flex w-12 shrink-0 flex-col items-center gap-2 overflow-y-auto border-r border-border-subtle bg-base-secondary py-2 custom-scrollbar"
      >
        <button
          type="button"
          data-testid="workbench-left-open"
          className={WORKBENCH_ICON_BUTTON_CLASS}
          aria-expanded={false}
          aria-label={t(I18nKey.WORKBENCH$SHOW_LEFT_PANEL)}
          data-tip={t(I18nKey.WORKBENCH$SHOW_LEFT_PANEL_TIP)}
          onClick={toggle}
        >
          <ChevronsRight size={14} aria-hidden />
        </button>
        <div className="my-1 h-px w-6 bg-border-subtle" />
        {WORKBENCH_ROLES.map((role) => {
          const agent = agentFor(role);
          return (
            <button
              key={role.id}
              type="button"
              draggable
              data-testid={`workbench-rail-role-${role.id}`}
              aria-label={t(ROLE_LABEL_KEYS[role.id])}
              data-tip={
                agent
                  ? `${t(ROLE_LABEL_KEYS[role.id])} · ${agent.doing}`
                  : t(ROLE_LABEL_KEYS[role.id])
              }
              className="rounded-full outline-none focus-visible:outline-2 focus-visible:outline-focus"
              onClick={() => (agent ? focusAgent(agent) : onTalkTo(role, null))}
              onContextMenu={(event) => roleMenu(event, role, agent)}
              onDragStart={(event) => dragAgent(event, agent, role)}
              onPointerEnter={() => agent && setHoverAgent(agent.id)}
              onPointerLeave={() => setHoverAgent(null)}
            >
              {avatar(role, agent)}
            </button>
          );
        })}
        {scheduled.map((agent) => (
          <button
            key={agent.id}
            type="button"
            draggable
            data-testid={`workbench-rail-agent-${agent.id}`}
            aria-label={agent.name}
            data-tip={`${agent.name} · ${agent.doing}`}
            className="rounded-full outline-none focus-visible:outline-2 focus-visible:outline-focus"
            onClick={() => focusAgent(agent)}
            onDragStart={(event) => {
              event.dataTransfer.setData(WORKBENCH_DRAG_TYPES.agent, agent.id);
            }}
            onPointerEnter={() => setHoverAgent(agent.id)}
            onPointerLeave={() => setHoverAgent(null)}
          >
            <span
              className={cn(
                WORKBENCH_AVATAR_CLASS,
                accentBgClass(agent.accent),
                "opacity-80",
              )}
            >
              {agent.initials}
            </span>
          </button>
        ))}
        <div className="my-1 h-px w-6 bg-border-subtle" />
        {WORKBENCH_PART_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            draggable
            data-testid={`workbench-rail-kind-${kind}`}
            aria-label={t(KIND_LABEL_KEYS[kind])}
            data-tip={t(I18nKey.WORKBENCH$TIP_DRAG_KIND, {
              kind: t(KIND_LABEL_KEYS[kind]),
            })}
            className="inline-flex h-7 w-7 cursor-grab items-center justify-center rounded-md border border-border-subtle bg-surface font-mono text-[10px] font-bold text-text-secondary hover:bg-interactive-hover"
            onDragStart={(event) => dragKind(event, kind)}
          >
            {WORKBENCH_KIND_BADGES[kind]}
          </button>
        ))}
        {otherRepos.length > 0 && (
          <div className="my-1 h-px w-6 bg-border-subtle" />
        )}
        {otherRepos.map((repo) => (
          <button
            key={repo.id}
            type="button"
            draggable
            data-testid={`workbench-rail-repo-${repo.id}`}
            aria-label={repo.name}
            data-tip={t(I18nKey.WORKBENCH$TIP_DRAG_REPO, { name: repo.name })}
            className={cn(
              "h-5 w-5 cursor-grab rounded-full border-2 bg-surface",
              accentBorderClass(repo.accent),
            )}
            onClick={() => onAddRepo(repo)}
            onContextMenu={(event) => repoMenu(event, repo)}
            onDragStart={(event) => dragRepo(event, repo)}
          />
        ))}
      </aside>
    );
  }

  return (
    <aside
      data-testid="workbench-left-panel"
      aria-label={t(I18nKey.WORKBENCH$LEFT_PANEL)}
      className={cn(WORKBENCH_PANEL_CLASS, "w-64 shrink-0 border-r")}
    >
      <div className="flex items-center justify-between">
        <span className={WORKBENCH_SECTION_LABEL_CLASS}>
          {t(I18nKey.WORKBENCH$TEAM)}
        </span>
        <button
          type="button"
          data-testid="workbench-left-close"
          className={WORKBENCH_ICON_BUTTON_CLASS}
          aria-expanded
          aria-label={t(I18nKey.WORKBENCH$HIDE_LEFT_PANEL)}
          data-tip={t(I18nKey.WORKBENCH$HIDE_LEFT_PANEL_TIP)}
          onClick={toggle}
        >
          <ChevronsLeft size={14} aria-hidden />
        </button>
      </div>
      <ul className="flex flex-col gap-1">
        {WORKBENCH_ROLES.map((role) => {
          const agent = agentFor(role);
          return (
            <li key={role.id}>
              <button
                type="button"
                draggable
                data-testid={`workbench-role-${role.id}`}
                data-tip={t(ROLE_BLURB_KEYS[role.id])}
                className="flex w-full cursor-grab items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-interactive-hover"
                onClick={() =>
                  agent ? focusAgent(agent) : onTalkTo(role, null)
                }
                onContextMenu={(event) => roleMenu(event, role, agent)}
                onDragStart={(event) => dragAgent(event, agent, role)}
                onPointerEnter={() => agent && setHoverAgent(agent.id)}
                onPointerLeave={() => setHoverAgent(null)}
              >
                {avatar(role, agent)}
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-xs font-medium text-foreground">
                    {t(ROLE_LABEL_KEYS[role.id])}
                  </span>
                  <span className="truncate text-micro text-muted">
                    {agent ? agent.doing : t(ROLE_BLURB_KEYS[role.id])}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {scheduled.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className={WORKBENCH_SECTION_LABEL_CLASS}>
            {t(I18nKey.WORKBENCH$SCHEDULED)}
            <span>{scheduled.length}</span>
          </span>
          <ul className="flex flex-col gap-1">
            {scheduled.map((agent) => (
              <li key={agent.id}>
                <button
                  type="button"
                  draggable
                  data-testid={`workbench-agent-${agent.id}`}
                  data-tip={agent.next}
                  className="flex w-full cursor-grab items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-interactive-hover"
                  onClick={() => focusAgent(agent)}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(
                      WORKBENCH_DRAG_TYPES.agent,
                      agent.id,
                    );
                  }}
                  onPointerEnter={() => setHoverAgent(agent.id)}
                  onPointerLeave={() => setHoverAgent(null)}
                >
                  <span
                    className={cn(
                      WORKBENCH_AVATAR_CLASS,
                      accentBgClass(agent.accent),
                      "opacity-80",
                    )}
                  >
                    {agent.initials}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-xs font-medium text-foreground">
                      {agent.name}
                    </span>
                    <span className="truncate text-micro text-muted">
                      {t(AGENT_STATE_KEYS[agent.state])} · {agent.doing}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <span className={WORKBENCH_SECTION_LABEL_CLASS}>
          {t(I18nKey.WORKBENCH$ADD_A_PART)}
          <span className="normal-case tracking-normal">
            {t(I18nKey.WORKBENCH$DRAG_ONTO_MAP)}
          </span>
        </span>
        <div className="grid grid-cols-3 gap-1.5">
          {WORKBENCH_PART_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              draggable
              data-testid={`workbench-library-${kind}`}
              data-tip={t(I18nKey.WORKBENCH$TIP_DRAG_KIND, {
                kind: t(KIND_LABEL_KEYS[kind]),
              })}
              className="flex cursor-grab flex-col items-center gap-0.5 rounded-md border border-border-subtle bg-surface px-1 py-1.5 text-micro text-text-secondary hover:bg-interactive-hover"
              onDragStart={(event) => dragKind(event, kind)}
            >
              <span className="font-mono text-[10px] font-bold">
                {WORKBENCH_KIND_BADGES[kind]}
              </span>
              <span className="truncate">{t(KIND_LABEL_KEYS[kind])}</span>
            </button>
          ))}
        </div>
      </div>

      {otherRepos.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className={WORKBENCH_SECTION_LABEL_CLASS}>
            {t(I18nKey.WORKBENCH$OTHER_REPOS)}
            <span className="normal-case tracking-normal">
              {t(I18nKey.WORKBENCH$DRAG_ONTO_MAP)}
            </span>
          </span>
          <div className="flex flex-wrap gap-1.5">
            {otherRepos.map((repo) => (
              <button
                key={repo.id}
                type="button"
                draggable
                data-testid={`workbench-repo-chip-${repo.id}`}
                data-tip={
                  repo.hasMap
                    ? t(I18nKey.WORKBENCH$TIP_REPO_HAS_MAP)
                    : t(I18nKey.WORKBENCH$TIP_REPO_NO_MAP)
                }
                className={cn(
                  "inline-flex cursor-grab items-center gap-1.5 rounded-md border-l-4 border border-border-subtle bg-surface px-2 py-1 text-xs text-foreground hover:bg-interactive-hover",
                  accentBorderClass(repo.accent),
                )}
                onClick={() => onAddRepo(repo)}
                onContextMenu={(event) => repoMenu(event, repo)}
                onDragStart={(event) => dragRepo(event, repo)}
              >
                {repo.name}
                {!repo.hasMap && (
                  <span className="text-micro text-muted">
                    {t(I18nKey.WORKBENCH$NO_MAP_SHORT)}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="text-micro leading-relaxed text-muted">
        {t(I18nKey.WORKBENCH$HINT)}
      </p>
    </aside>
  );
}
