/**
 * What the agents are told when the user talks to them from the workbench.
 *
 * The chat has two personas. The Architect owns the design map and is asked
 * about parts and wires; the project manager owns the plan and is asked
 * about stories and sprints. Both get the same two things the user can see:
 * the selection, and where the document lives, so "do it" is something the
 * agent can act on by editing the file.
 */

import {
  WORKBENCH_FILE_PATH,
  type WorkbenchDocument,
  type WorkbenchPersona,
} from "#/types/workbench";
import { partById, repoById } from "./workbench-geometry";

export interface WorkbenchChatContext {
  persona: WorkbenchPersona;
  document: WorkbenchDocument;
  projectName: string;
  selectedPartIds: string[];
  selectedWireId: string | null;
  selectedItemId: string | null;
  /** Absolute path of the open document, when the page knows it. */
  documentPath: string | null;
}

const PERSONA_BRIEF: Record<WorkbenchPersona, string> = {
  arch: "You are the Architect of this project. You own the design map: the repos, their parts (routes, components, hooks, services, endpoints, tables, jobs, modules, external systems) and the wires between them. Keep the map and the code in agreement, point out drift, and when asked to change the design, edit the document and explain the change in one or two sentences.",
  pm: "You are the project manager of this team. You own the plan: epics, sprints and stories on the kanban board. Break work into stories with acceptance criteria, keep each sprint within the team's velocity, assign roles, and when asked to plan or re-plan, edit the document and say what moved and why in a few sentences.",
};

function describeSelection(context: WorkbenchChatContext): string[] {
  const { document } = context;
  const lines: string[] = [];
  for (const id of context.selectedPartIds) {
    const part = partById(document, id);
    if (!part) continue;
    const repo = repoById(document, part.repoId);
    const files =
      part.files.length > 0 ? ` files: ${part.files.join(", ")}.` : "";
    lines.push(
      `- ${part.kind} "${part.name}" in ${repo?.name ?? part.repoId} (${part.status}).${files}${part.drift ? ` Drift: ${part.drift}` : ""}`,
    );
  }
  if (context.selectedWireId) {
    const wire = document.wires.find((w) => w.id === context.selectedWireId);
    if (wire) {
      const from = partById(document, wire.from)?.name ?? wire.from;
      const to = partById(document, wire.to)?.name ?? wire.to;
      lines.push(`- wire: ${from} ${wire.label} ${to}`);
    }
  }
  if (context.selectedItemId) {
    const item = document.work.find((w) => w.id === context.selectedItemId);
    if (item) {
      const epic = document.epics.find((e) => e.id === item.epicId);
      lines.push(
        `- ${item.type} ${item.key} "${item.title}" (${item.points} pts, ${item.stage}${epic ? `, epic ${epic.title}` : ""}${item.sprintId ? `, sprint ${item.sprintId}` : ", backlog"})`,
      );
    }
  }
  return lines;
}

/** The message a send becomes: the user's words, then a context block. */
export function buildWorkbenchMessage(
  question: string,
  context: WorkbenchChatContext,
): string {
  const selection = describeSelection(context);
  const where = context.documentPath ?? WORKBENCH_FILE_PATH;
  const block = [
    "",
    "---",
    `[Workbench context] ${PERSONA_BRIEF[context.persona]}`,
    `Project: ${context.projectName}. The workbench document is at ${where}; the page re-reads it after you write it.`,
    selection.length > 0
      ? `The user has selected:\n${selection.join("\n")}`
      : "Nothing is selected.",
  ];
  return `${question.trim()}\n${block.join("\n")}`;
}

/** The first message of a crawl: build this repo's part of the map. */
export function buildCrawlMessage(
  repoName: string,
  documentPath: string | null,
): string {
  return [
    `Crawl the repository "${repoName}" and add its parts and wires to the workbench document at ${documentPath ?? WORKBENCH_FILE_PATH}.`,
    "List routes, components, hooks, services, endpoints, tables, jobs and modules as parts under this repo, and the calls, renders, reads, writes and imports between them as wires. Mark anything you are not sure about in the part's `unsure` field rather than guessing silently.",
  ].join("\n");
}
