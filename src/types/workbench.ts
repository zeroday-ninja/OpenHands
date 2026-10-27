/**
 * The workbench document: one visual-first workspace spanning several repos.
 *
 * Everything the Design view draws and the Work view plans lives in one file,
 * `.openhands/workbench.json`, so that the Architect and project-manager
 * agents can edit it from inside a conversation and the page can pick the
 * edit up by re-reading the file. There is no second source of truth: the
 * kanban board, the sprint plan, the repo groups and the wires are all views
 * over this document.
 *
 * Positions are in canvas units. A part's `x`/`y` is relative to its repo
 * group's origin, so moving a group never has to rewrite every part in it.
 */

export const WORKBENCH_ROUTE_PATH = "/workbench";
export const WORKBENCH_FILE_PATH = ".openhands/workbench.json";
export const WORKBENCH_DOCUMENT_VERSION = 1;

export const WORKBENCH_PART_WIDTH = 170;
export const WORKBENCH_PART_HEIGHT = 50;

export const WORKBENCH_PART_KINDS = [
  "route",
  "component",
  "hook",
  "service",
  "endpoint",
  "table",
  "job",
  "module",
  "external",
] as const;
export type WorkbenchPartKind = (typeof WORKBENCH_PART_KINDS)[number];

/** Two-letter badge drawn on a part, by kind. */
export const WORKBENCH_KIND_BADGES: Record<WorkbenchPartKind, string> = {
  route: "RT",
  component: "CO",
  hook: "HK",
  service: "SV",
  endpoint: "EP",
  table: "TB",
  job: "JB",
  module: "MD",
  external: "EX",
};

export const WORKBENCH_PART_STATUSES = ["planned", "built", "live"] as const;
export type WorkbenchPartStatus = (typeof WORKBENCH_PART_STATUSES)[number];

export const WORKBENCH_WIRE_LABELS = [
  "renders",
  "calls",
  "reads",
  "writes",
  "imports",
  "publishes",
  "planned",
] as const;
export type WorkbenchWireLabel = (typeof WORKBENCH_WIRE_LABELS)[number];

/** Accent slot, mapped to the `map-accent-*` theme tokens. */
export type WorkbenchAccent = 1 | 2 | 3 | 4 | 5 | 6;

export interface WorkbenchRepo {
  id: string;
  name: string;
  accent: WorkbenchAccent;
  /** Group origin on the canvas. Parts are placed relative to it. */
  x: number;
  y: number;
  /** True for the pseudo-repo holding third-party systems. */
  external?: boolean;
  /** Whether a `.openhands/project-map.json` exists to seed parts from. */
  hasMap: boolean;
  /** How many files the last crawl saw, for the progress bar. */
  files?: number;
}

export interface WorkbenchPart {
  id: string;
  repoId: string;
  kind: WorkbenchPartKind;
  name: string;
  x: number;
  y: number;
  status: WorkbenchPartStatus;
  files: string[];
  /** Test coverage in percent, or null when nothing measures it. */
  tests: number | null;
  /** Lines changed on the current branch. */
  changes: number;
  description?: string;
  /** What the Architect found differs between code and design. */
  drift?: string;
  /** What the crawl was not sure about. */
  unsure?: string;
  /** Why the autonomous work stopped here and waits for the user. */
  gate?: string;
}

export interface WorkbenchWire {
  id: string;
  from: string;
  to: string;
  label: WorkbenchWireLabel;
}

export interface WorkbenchPoint {
  x: number;
  y: number;
}

/** A hand-drawn circle around anything on the canvas, numbered in order. */
export interface WorkbenchHighlight {
  id: string;
  points: WorkbenchPoint[];
}

export interface WorkbenchProject {
  id: string;
  name: string;
  repoIds: string[];
}

export const WORKBENCH_ROLE_IDS = [
  "pm",
  "arch",
  "fe",
  "be",
  "qa",
  "rev",
  "ops",
] as const;
export type WorkbenchRoleId = (typeof WORKBENCH_ROLE_IDS)[number];

export interface WorkbenchRole {
  id: WorkbenchRoleId;
  initials: string;
  accent: WorkbenchAccent;
}

/**
 * The team. Each role is an agent profile in the Agent Server; the names and
 * blurbs are translated, so only the stable identity is here.
 */
export const WORKBENCH_ROLES: WorkbenchRole[] = [
  { id: "pm", initials: "PM", accent: 5 },
  { id: "arch", initials: "AR", accent: 3 },
  { id: "fe", initials: "FE", accent: 1 },
  { id: "be", initials: "BE", accent: 2 },
  { id: "qa", initials: "QA", accent: 4 },
  { id: "rev", initials: "RV", accent: 6 },
  { id: "ops", initials: "OP", accent: 5 },
];

/** The two personas the chat can address. */
export type WorkbenchPersona = "arch" | "pm";

export const WORKBENCH_AGENT_STATES = [
  "running",
  "waiting",
  "scheduled",
  "idle",
] as const;
export type WorkbenchAgentState = (typeof WORKBENCH_AGENT_STATES)[number];

/**
 * What the autonomous work is focused on. A running agent has a current part
 * and a trail of parts it has touched; a scheduled job has targets.
 */
export interface WorkbenchAgent {
  id: string;
  role: WorkbenchRoleId | null;
  name: string;
  initials: string;
  accent: WorkbenchAccent;
  state: WorkbenchAgentState;
  focus: string | null;
  trail: string[];
  targets: string[];
  doing: string;
  next: string;
  /** The conversation driving this agent, when there is one. */
  conversationId?: string;
}

export const WORKBENCH_STAGES = [
  "backlog",
  "build",
  "test",
  "review",
  "done",
] as const;
export type WorkbenchStage = (typeof WORKBENCH_STAGES)[number];

export const WORKBENCH_ITEM_TYPES = ["story", "task", "bug"] as const;
export type WorkbenchItemType = (typeof WORKBENCH_ITEM_TYPES)[number];

export interface WorkbenchEpic {
  id: string;
  key: string;
  title: string;
  accent: WorkbenchAccent;
  goal: string;
  /** Last issued story number under this key. */
  counter: number;
}

export type WorkbenchSprintState = "closed" | "active" | "planned";

export interface WorkbenchSprint {
  id: string;
  number: number;
  /** Human-readable date range, written by the PM. */
  dates: string;
  state: WorkbenchSprintState;
  goal: string;
  days: number;
  day: number;
  /** Fraction of points left at the end of each day so far. */
  burndown: number[];
  review?: string;
}

export interface WorkbenchWorkItem {
  id: string;
  key: string;
  type: WorkbenchItemType;
  title: string;
  epicId: string;
  sprintId: string | null;
  points: number;
  partId: string | null;
  stage: WorkbenchStage;
  role: WorkbenchRoleId | null;
  percent?: number;
  note?: string;
  blocked?: string;
  pr?: number;
  acceptance?: string[];
  tasks?: string[];
}

export interface WorkbenchDocument {
  version: typeof WORKBENCH_DOCUMENT_VERSION;
  projects: WorkbenchProject[];
  repos: WorkbenchRepo[];
  parts: WorkbenchPart[];
  wires: WorkbenchWire[];
  highlights: WorkbenchHighlight[];
  agents: WorkbenchAgent[];
  epics: WorkbenchEpic[];
  sprints: WorkbenchSprint[];
  work: WorkbenchWorkItem[];
  /** Points the team finished per sprint, used to plan the next one. */
  velocity: number;
}

export type WorkbenchMode = "design" | "work";
export type WorkbenchTool = "select" | "highlight";
export type WorkbenchLevel = "parts" | "repos";

export function emptyWorkbenchDocument(): WorkbenchDocument {
  return {
    version: WORKBENCH_DOCUMENT_VERSION,
    projects: [],
    repos: [],
    parts: [],
    wires: [],
    highlights: [],
    agents: [],
    epics: [],
    sprints: [],
    work: [],
    velocity: 20,
  };
}
