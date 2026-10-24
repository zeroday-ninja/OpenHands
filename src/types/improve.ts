/**
 * Wire types for the automation backend's improvement-program API
 * (`/api/automation/v1/improve/*` and `POST /api/automation/v1/preset/improve`).
 *
 * An improvement program is an ordinary automation whose
 * `preset_metadata.preset_type` is `"improve"`. Each of its runs claims the
 * next repository in a rotation, has the builder agent profile research and
 * implement one improvement there with cited sources, and then has every
 * other available agent runtime review that change adversarially. The names
 * and shapes below mirror `openhands/automation/improve/schemas.py` and
 * `config.py`; the service speaks snake_case, so these do too.
 */

import type { AutomationTrigger } from "#/types/automation";

/** Marks the automation as an improvement program in `preset_metadata`. */
export const IMPROVE_PRESET_TYPE = "improve";

/**
 * Lifecycle of one cycle. A cycle is claimed before any agent starts, so an
 * interrupted run leaves a row behind that records which repository it took.
 */
export enum ImproveCycleStatus {
  CLAIMED = "CLAIMED",
  BUILDING = "BUILDING",
  REVIEWING = "REVIEWING",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
}

/**
 * What the adversarial review concluded.
 *
 * `SINGLE_RUNTIME` is not a quality judgement: no second runtime was
 * available, so the change carries only its builder's own word. `NO_CHANGE`
 * records a cycle that researched and deliberately changed nothing. Neither
 * is a pass, which is why the dashboard must not render them like `ACCEPTED`.
 */
export enum ImproveVerdict {
  ACCEPTED = "ACCEPTED",
  CHANGES_REQUESTED = "CHANGES_REQUESTED",
  REJECTED = "REJECTED",
  INCONCLUSIVE = "INCONCLUSIVE",
  SINGLE_RUNTIME = "SINGLE_RUNTIME",
  NO_CHANGE = "NO_CHANGE",
}

/** Statuses a cycle never leaves, so the dashboard can stop polling. */
export const TERMINAL_IMPROVE_CYCLE_STATUSES: readonly ImproveCycleStatus[] = [
  ImproveCycleStatus.COMPLETED,
  ImproveCycleStatus.FAILED,
];

/** One repository in a program's rotation. */
export interface ImproveCycleRepository {
  label: string;
  url: string;
  ref: string | null;
  /** Position in the rotation. */
  index: number;
  /** The Git Sync remote this entry came from, when it came from one. */
  remote_id: string | null;
}

/** A source the builder based its change on. */
export interface ImproveCitedSource {
  url: string;
  title: string | null;
  /** What this source actually supports in the change. */
  note: string | null;
}

/** One runtime's adversarial review of a cycle's change. */
export interface ImproveCycleReview {
  profile_id: string | null;
  profile_name: string | null;
  /**
   * The runtime that reviewed, e.g. `claude-code` or `codex`. This is what
   * makes the review independent of the builder's own runtime.
   */
  runtime: string | null;
  conversation_id: string | null;
  verdict: ImproveVerdict | null;
  summary: string | null;
  concerns: string[];
  /** Sources the reviewer found outdated or superseded. */
  stale_sources: string[];
  /**
   * What this reviewer compared the change against to see whether anything
   * supersedes it, and what it concluded — including an explicit "nothing
   * newer", which is a different statement from having said nothing.
   *
   * A reviewer that ran without answering is recorded with a sentence saying
   * so, so this is empty only for a review that never finished or a cycle
   * from before the question was asked.
   */
  updates_checked: string | null;
}

/**
 * Something a cycle learned about how the user wants to be worked for.
 *
 * A proposal for the user's `SOUL.md`, never an edit to it: the service gives
 * a run no way to rewrite the document that tells every future run what the
 * user wants, so the user accepts or discards each entry themselves.
 */
export interface ImproveSoulSuggestion {
  /** The preference, written as the user would want it stated. */
  text: string;
  /** What in this cycle suggested it, so the user can judge it. */
  why: string | null;
}

/** One recorded pass of a program over one repository. */
export interface ImproveCycle {
  id: string;
  automation_id: string;
  run_id: string | null;
  status: ImproveCycleStatus;
  verdict: ImproveVerdict | null;
  repository: ImproveCycleRepository;
  builder_profile_id: string | null;
  builder_runtime: string | null;
  builder_conversation_id: string | null;
  summary: string | null;
  branch: string | null;
  pr_url: string | null;
  sources: ImproveCitedSource[];
  reviews: ImproveCycleReview[];
  /** Proposals for the user's SOUL.md, from either stage of the cycle. */
  soul_suggestions: ImproveSoulSuggestion[];
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

/**
 * Where a rotation's repositories come from: the organization's Git Sync
 * remotes, or the program's own explicit list.
 */
export type ImproveRepositorySource = "git_sync" | "explicit";

export interface ImproveExplicitRepository {
  label: string;
  url: string;
  ref?: string | null;
}

/** What one program does on each of its runs. */
export interface ImproveProgramConfig {
  builder_profile_id: string;
  /**
   * Further profiles that take turns building, after `builder_profile_id`.
   * Empty keeps one builder — and that one runtime then never reviews
   * anything. The service refuses it alongside explicit
   * `reviewer_profile_ids`: on the turn a named reviewer builds, it would be
   * asked to review its own work.
   */
  rotate_builder: string[];
  /** Empty means "every available runtime other than the builder's". */
  reviewer_profile_ids: string[];
  repository_source: ImproveRepositorySource;
  repositories: ImproveExplicitRepository[];
  /** Git Sync label filter; empty means every synced repository. */
  repository_labels: string[];
  branch_prefix: string;
  max_changed_files: number;
  open_pr: boolean;
  focus: string | null;
}

/** The program's rotation as it stands, from `GET /{id}/rotation`. */
export interface ImproveRotationResponse {
  repositories: ImproveCycleRepository[];
  /**
   * Which entry the next run will take. Null when the rotation is empty,
   * which is also why a program can have nothing to do.
   */
  next_index: number | null;
  last_cycle: ImproveCycle | null;
  config: ImproveProgramConfig;
}

/** A page of cycle history, newest first, from `GET /{id}/cycles`. */
export interface ImproveCycleListResponse {
  cycles: ImproveCycle[];
  total: number;
}

export interface ImproveCycleListParams {
  limit?: number;
  offset?: number;
}

/**
 * The configuration half of a create request. Only the builder profile is
 * required; the service fills in its own documented defaults for the rest.
 */
export type ImproveProgramConfigInput = Pick<
  ImproveProgramConfig,
  "builder_profile_id"
> &
  Partial<Omit<ImproveProgramConfig, "builder_profile_id">>;

/** Body of `POST /api/automation/v1/preset/improve`. */
export interface CreateImprovementProgramRequest {
  name: string;
  /**
   * When a cycle runs. A cron trigger is the normal choice: a program works
   * through its repositories on a cadence.
   */
  trigger: AutomationTrigger;
  improve: ImproveProgramConfigInput;
  observability_associations?: Record<string, string> | null;
  timeout?: number | null;
  keep_alive?: boolean | null;
  enabled?: boolean;
}
