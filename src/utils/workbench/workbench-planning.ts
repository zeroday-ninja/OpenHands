/**
 * What the project manager does with the plan, as pure functions over the
 * document: points, progress, which sprint is running, which stories fit in
 * the next one. The store applies these; the PM agent is told about them in
 * its context so what it does in chat and what the board does agree.
 */

import type {
  WorkbenchDocument,
  WorkbenchEpic,
  WorkbenchSprint,
  WorkbenchWorkItem,
} from "#/types/workbench";

export function pointsOf(items: WorkbenchWorkItem[]) {
  return items.reduce((sum, item) => sum + item.points, 0);
}

export function itemsInSprint(
  document: WorkbenchDocument,
  sprintId: string | null,
) {
  return document.work.filter((item) => item.sprintId === sprintId);
}

export function activeSprint(document: WorkbenchDocument) {
  return document.sprints.find((sprint) => sprint.state === "active") ?? null;
}

export function plannedSprint(document: WorkbenchDocument) {
  return document.sprints.find((sprint) => sprint.state === "planned") ?? null;
}

export function epicProgress(document: WorkbenchDocument, epicId: string) {
  const all = document.work.filter((item) => item.epicId === epicId);
  const done = all.filter((item) => item.stage === "done");
  return Math.round((100 * pointsOf(done)) / Math.max(1, pointsOf(all)));
}

/** Points done, left and total for a sprint. */
export function sprintTotals(document: WorkbenchDocument, sprintId: string) {
  const items = itemsInSprint(document, sprintId);
  const total = pointsOf(items);
  const done = pointsOf(items.filter((item) => item.stage === "done"));
  return { total, done, left: total - done };
}

/** Issue the next key under an epic, e.g. `ROLE-12`. */
export function nextKey(epic: WorkbenchEpic) {
  return { key: `${epic.key}-${epic.counter + 1}`, counter: epic.counter + 1 };
}

/**
 * Fill a planned sprint from the backlog up to the team's velocity, biggest
 * stories first so the fit is tight, keeping stories of the sprint's epic
 * ahead of the rest.
 */
export function planSprint(
  document: WorkbenchDocument,
  sprint: WorkbenchSprint,
): string[] {
  const already = pointsOf(itemsInSprint(document, sprint.id));
  let room = document.velocity - already;
  const backlog = document.work
    .filter((item) => item.sprintId === null && item.stage !== "done")
    .sort((a, b) => b.points - a.points);
  const picked: string[] = [];
  for (const item of backlog) {
    if (item.points <= room) {
      picked.push(item.id);
      room -= item.points;
    }
  }
  return picked;
}

/** A story too big for one sprint becomes smaller stories under the same epic. */
export function splitStory(
  item: WorkbenchWorkItem,
  into = 2,
): Pick<WorkbenchWorkItem, "title" | "points">[] {
  const each = Math.max(1, Math.round(item.points / into));
  return Array.from({ length: into }, (_, index) => ({
    title: `${item.title} · part ${index + 1}`,
    points: each,
  }));
}

/** Burndown so far, plus a straight guide line, as 0..1 fractions per day. */
export function burndownSeries(sprint: WorkbenchSprint) {
  const guide = Array.from(
    { length: sprint.days + 1 },
    (_, day) => 1 - day / sprint.days,
  );
  return { actual: [1, ...sprint.burndown], guide };
}

/** Whether a sprint can be closed: everything is done or carried over. */
export function sprintCarryOver(document: WorkbenchDocument, sprintId: string) {
  return itemsInSprint(document, sprintId).filter(
    (item) => item.stage !== "done",
  );
}
