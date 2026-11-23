/**
 * Reading `.openhands/workbench.json` defensively.
 *
 * The file is edited by agents and by hand, so a missing array or an unknown
 * kind is normal rather than exceptional. Parsing fills in defaults and drops
 * what it cannot place (a wire to a part that no longer exists, a story in an
 * unknown epic) instead of refusing the whole document, and reports what it
 * dropped so the page can say so.
 */

import {
  WORKBENCH_AGENT_STATES,
  WORKBENCH_DOCUMENT_VERSION,
  WORKBENCH_ITEM_TYPES,
  WORKBENCH_PART_KINDS,
  WORKBENCH_PART_STATUSES,
  WORKBENCH_ROLE_IDS,
  WORKBENCH_STAGES,
  WORKBENCH_WIRE_LABELS,
  emptyWorkbenchDocument,
  type WorkbenchAccent,
  type WorkbenchAgent,
  type WorkbenchDocument,
  type WorkbenchEpic,
  type WorkbenchHighlight,
  type WorkbenchPart,
  type WorkbenchProject,
  type WorkbenchRepo,
  type WorkbenchSprint,
  type WorkbenchWire,
  type WorkbenchWorkItem,
} from "#/types/workbench";

export interface WorkbenchParseResult {
  document: WorkbenchDocument | null;
  /** One line per thing that was dropped or defaulted. */
  warnings: string[];
  /** Set when the file is not a JSON object at all. */
  failure: string | null;
}

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function strList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function accent(value: unknown, fallback: WorkbenchAccent): WorkbenchAccent {
  const n = num(value, fallback);
  return n >= 1 && n <= 6 ? (Math.round(n) as WorkbenchAccent) : fallback;
}

function records(value: unknown): Raw[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function parseRepos(raw: unknown): WorkbenchRepo[] {
  return records(raw)
    .filter((r) => typeof r.id === "string")
    .map((r, index) => ({
      id: r.id as string,
      name: str(r.name, r.id as string),
      accent: accent(r.accent, ((index % 6) + 1) as WorkbenchAccent),
      x: num(r.x),
      y: num(r.y),
      ...(r.external === true ? { external: true } : {}),
      hasMap: r.hasMap !== false,
      ...(typeof r.files === "number" ? { files: r.files } : {}),
    }));
}

function parseParts(raw: unknown, repoIds: Set<string>, warnings: string[]) {
  const parts: WorkbenchPart[] = [];
  for (const r of records(raw)) {
    if (typeof r.id !== "string" || typeof r.repoId !== "string") continue;
    if (!repoIds.has(r.repoId)) {
      warnings.push(`Part ${r.id} belongs to unknown repo ${r.repoId}`);
      continue;
    }
    parts.push({
      id: r.id,
      repoId: r.repoId,
      kind: oneOf(r.kind, WORKBENCH_PART_KINDS, "module"),
      name: str(r.name, r.id),
      x: num(r.x),
      y: num(r.y),
      status: oneOf(r.status, WORKBENCH_PART_STATUSES, "built"),
      files: strList(r.files),
      tests: typeof r.tests === "number" ? r.tests : null,
      changes: num(r.changes),
      ...(typeof r.description === "string"
        ? { description: r.description }
        : {}),
      ...(typeof r.drift === "string" ? { drift: r.drift } : {}),
      ...(typeof r.unsure === "string" ? { unsure: r.unsure } : {}),
      ...(typeof r.gate === "string" ? { gate: r.gate } : {}),
    });
  }
  return parts;
}

function parseWires(raw: unknown, partIds: Set<string>, warnings: string[]) {
  const wires: WorkbenchWire[] = [];
  for (const r of records(raw)) {
    if (typeof r.from !== "string" || typeof r.to !== "string") continue;
    if (!partIds.has(r.from) || !partIds.has(r.to)) {
      warnings.push(`Wire ${r.from} → ${r.to} points at a missing part`);
      continue;
    }
    wires.push({
      id: str(r.id, `${r.from}->${r.to}`),
      from: r.from,
      to: r.to,
      label: oneOf(r.label, WORKBENCH_WIRE_LABELS, "calls"),
    });
  }
  return wires;
}

function parseHighlights(raw: unknown): WorkbenchHighlight[] {
  return records(raw)
    .map((r, index) => ({
      id: str(r.id, `h${index}`),
      points: records(r.points).map((p) => ({ x: num(p.x), y: num(p.y) })),
    }))
    .filter((h) => h.points.length >= 3);
}

function parseAgents(raw: unknown, partIds: Set<string>): WorkbenchAgent[] {
  return records(raw)
    .filter((r) => typeof r.id === "string")
    .map((r, index) => {
      const focus =
        typeof r.focus === "string" && partIds.has(r.focus) ? r.focus : null;
      const role =
        typeof r.role === "string" &&
        (WORKBENCH_ROLE_IDS as readonly string[]).includes(r.role)
          ? (r.role as WorkbenchAgent["role"])
          : null;
      return {
        id: r.id as string,
        role,
        name: str(r.name, r.id as string),
        initials: str(r.initials, (r.id as string).slice(0, 2).toUpperCase()),
        accent: accent(r.accent, ((index % 6) + 1) as WorkbenchAccent),
        state: oneOf(r.state, WORKBENCH_AGENT_STATES, "idle"),
        focus,
        trail: strList(r.trail).filter((id) => partIds.has(id)),
        targets: strList(r.targets).filter((id) => partIds.has(id)),
        doing: str(r.doing),
        next: str(r.next),
        ...(typeof r.conversationId === "string"
          ? { conversationId: r.conversationId }
          : {}),
      };
    });
}

function parseEpics(raw: unknown): WorkbenchEpic[] {
  return records(raw)
    .filter((r) => typeof r.id === "string")
    .map((r, index) => ({
      id: r.id as string,
      key: str(r.key, (r.id as string).toUpperCase()),
      title: str(r.title, r.id as string),
      accent: accent(r.accent, ((index % 6) + 1) as WorkbenchAccent),
      goal: str(r.goal),
      counter: num(r.counter),
    }));
}

function parseSprints(raw: unknown): WorkbenchSprint[] {
  return records(raw)
    .filter((r) => typeof r.id === "string")
    .map((r, index) => ({
      id: r.id as string,
      number: num(r.number, index + 1),
      dates: str(r.dates),
      state: oneOf(
        r.state,
        ["closed", "active", "planned"] as const,
        "planned",
      ),
      goal: str(r.goal),
      days: num(r.days, 10),
      day: num(r.day),
      burndown: Array.isArray(r.burndown)
        ? r.burndown.filter((n): n is number => typeof n === "number")
        : [],
      ...(typeof r.review === "string" ? { review: r.review } : {}),
    }))
    .sort((a, b) => a.number - b.number);
}

function parseWork(
  raw: unknown,
  epics: WorkbenchEpic[],
  sprintIds: Set<string>,
  partIds: Set<string>,
  warnings: string[],
): WorkbenchWorkItem[] {
  const epicIds = new Set(epics.map((e) => e.id));
  const fallbackEpic = epics[0]?.id;
  const work: WorkbenchWorkItem[] = [];
  for (const r of records(raw)) {
    if (typeof r.id !== "string") continue;
    let epicId = str(r.epicId);
    if (!epicIds.has(epicId)) {
      if (fallbackEpic === undefined) {
        warnings.push(`Story ${r.id} has no epic to live in`);
        continue;
      }
      warnings.push(`Story ${r.id} moved to epic ${fallbackEpic}`);
      epicId = fallbackEpic;
    }
    const sprintId =
      typeof r.sprintId === "string" && sprintIds.has(r.sprintId)
        ? r.sprintId
        : null;
    const role =
      typeof r.role === "string" &&
      (WORKBENCH_ROLE_IDS as readonly string[]).includes(r.role)
        ? (r.role as WorkbenchWorkItem["role"])
        : null;
    work.push({
      id: r.id,
      key: str(r.key, r.id),
      type: oneOf(r.type, WORKBENCH_ITEM_TYPES, "story"),
      title: str(r.title, r.id),
      epicId,
      sprintId,
      points: num(r.points, 1),
      partId:
        typeof r.partId === "string" && partIds.has(r.partId) ? r.partId : null,
      stage: oneOf(r.stage, WORKBENCH_STAGES, "backlog"),
      role,
      ...(typeof r.percent === "number" ? { percent: r.percent } : {}),
      ...(typeof r.note === "string" ? { note: r.note } : {}),
      ...(typeof r.blocked === "string" ? { blocked: r.blocked } : {}),
      ...(typeof r.pr === "number" ? { pr: r.pr } : {}),
      ...(Array.isArray(r.acceptance)
        ? { acceptance: strList(r.acceptance) }
        : {}),
      ...(Array.isArray(r.tasks) ? { tasks: strList(r.tasks) } : {}),
    });
  }
  return work;
}

function parseProjects(raw: unknown, repoIds: Set<string>): WorkbenchProject[] {
  return records(raw)
    .filter((r) => typeof r.id === "string")
    .map((r) => ({
      id: r.id as string,
      name: str(r.name, r.id as string),
      repoIds: strList(r.repoIds).filter((id) => repoIds.has(id)),
    }));
}

export function parseWorkbench(raw: string): WorkbenchParseResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    return {
      document: null,
      warnings: [],
      failure: error instanceof Error ? error.message : "Invalid JSON",
    };
  }
  if (!isRecord(json)) {
    return {
      document: null,
      warnings: [],
      failure: "The workbench file is not a JSON object",
    };
  }
  const warnings: string[] = [];
  if (
    json.version !== undefined &&
    json.version !== WORKBENCH_DOCUMENT_VERSION
  ) {
    warnings.push(
      `Unknown document version ${String(json.version)}; read as version ${WORKBENCH_DOCUMENT_VERSION}`,
    );
  }
  const repos = parseRepos(json.repos);
  const repoIds = new Set(repos.map((r) => r.id));
  const parts = parseParts(json.parts, repoIds, warnings);
  const partIds = new Set(parts.map((p) => p.id));
  const epics = parseEpics(json.epics);
  const sprints = parseSprints(json.sprints);
  const sprintIds = new Set(sprints.map((s) => s.id));
  const document: WorkbenchDocument = {
    ...emptyWorkbenchDocument(),
    projects: parseProjects(json.projects, repoIds),
    repos,
    parts,
    wires: parseWires(json.wires, partIds, warnings),
    highlights: parseHighlights(json.highlights),
    agents: parseAgents(json.agents, partIds),
    epics,
    sprints,
    work: parseWork(json.work, epics, sprintIds, partIds, warnings),
    velocity: num(json.velocity, 20),
  };
  return { document, warnings, failure: null };
}

/** Stable, diff-friendly output: two-space indent and a trailing newline. */
export function serializeWorkbench(document: WorkbenchDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

/**
 * Identity of a file revision, so a re-read of unchanged bytes never discards
 * unsaved work. A cheap string hash is enough: it only has to tell two
 * different files apart, not resist anyone.
 */
export function workbenchRevision(path: string, raw: string | null): string {
  if (raw === null) return `${path}#absent`;
  let hash = 0;
  for (let index = 0; index < raw.length; index += 1) {
    hash = (hash * 31 + raw.charCodeAt(index)) | 0;
  }
  return `${path}#${raw.length}:${hash}`;
}
