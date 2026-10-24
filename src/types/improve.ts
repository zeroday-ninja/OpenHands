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
  /**
   * Waiting for a person. Not terminal and not a failure: the work is intact
   * on its branch, the cycle holds the phase it stopped at, and answering the
   * question resumes it from there. A breaking change always ends up here.
   */
  PARKED = "PARKED",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
}

/**
 * Where a gate sent the work, as opposed to what it thought of it.
 *
 * A verdict says whether a change is good; a route says what happens next. The
 * service records one of these at every gate, so a failed gate sends work
 * somewhere rather than ending it.
 */
export type ImproveRoute =
  | "approve"
  | "cycle"
  | "return"
  | "archive"
  | "escalate";

/** The routes a person may answer a parked cycle with. */
export const IMPROVE_RESOLVE_ROUTES: readonly ImproveRoute[] = [
  "approve",
  "cycle",
  "return",
  // `escalate` is absent on purpose: answering *is* the escalation, so
  // escalating again would park the cycle on the person who just unparked it.
  "archive",
];

/**
 * What a change does to anyone relying on the code, computed from its diff
 * rather than claimed by its builder. It is what decides who may publish.
 */
export type ImproveChangeClass = "additive" | "deleting" | "breaking";

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

/** Statuses a cycle never leaves. */
export const TERMINAL_IMPROVE_CYCLE_STATUSES: readonly ImproveCycleStatus[] = [
  ImproveCycleStatus.COMPLETED,
  ImproveCycleStatus.FAILED,
];

/**
 * Statuses that move on their own, which is what polling is for.
 *
 * `PARKED` is not terminal but belongs outside this list: it changes only when
 * a person answers, and whoever answers invalidates the query themselves.
 * Polling a parked cycle is a request every five seconds for as long as it
 * waits, which can be days.
 */
export const SELF_ADVANCING_IMPROVE_CYCLE_STATUSES: readonly ImproveCycleStatus[] =
  [
    ImproveCycleStatus.CLAIMED,
    ImproveCycleStatus.BUILDING,
    ImproveCycleStatus.REVIEWING,
  ];

/** One routing decision, with the reason it was taken. */
export interface ImproveGateDecision {
  phase?: string;
  route?: ImproveRoute;
  trigger?: string;
  rationale?: string;
  verdict?: string | null;
  change_class?: string | null;
  recommends?: string | null;
  decided_by?: string | null;
  at?: string | null;
  /**
   * Set when the service could not read the decision. Kept rather than
   * dropped: a client with a bug must not look like one that never decided.
   */
  unreadable?: boolean;
  problem?: string;
}

/** The judge's verdict on a cycle's removals. */
export interface ImproveJudgeAttestation {
  attested: boolean;
  runtime: string;
  summary: string;
  removals: {
    path: string;
    symbol: string | null;
    finding: string;
    where: string;
  }[];
  conversation_id: string | null;
  at?: string;
}

/** What a person needs in order to answer a breaking change. */
export interface ImproveChangeoverPlan {
  breaks?: string[];
  consumers?: string[];
  sequence?: string[];
  rollback?: string;
  branch?: string;
}

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
  // The change-risk gate. Optional because the automation service is
  // versioned separately from this app: a deployment running a service from
  // before the gate landed sends none of these, and a type that claimed
  // otherwise would turn that into undefined reads at render time.
  /**
   * Computed from the diff, never claimed by the builder. Null when the diff
   * could not be read — which is not the same as additive.
   */
  change_class?: ImproveChangeClass | null;
  /**
   * What the builder said it was. A claim below the computed class is a
   * finding, which is why both are kept.
   */
  claimed_change_class?: string | null;
  /** Where each gate sent the work, oldest first. */
  gate_decisions?: ImproveGateDecision[] | null;
  judge_attestation?: ImproveJudgeAttestation | null;
  /**
   * When the change landed, and the commit it became. The publish gate's
   * route says a merge was authorised, which is a decision; these say it
   * happened. Absent means "not recorded", which a service from before this
   * landed also reports — so absence is never rendered as "did not merge".
   */
  merged_at?: string | null;
  merge_commit_sha?: string | null;
  /** What this cycle needs a person to answer, when it is PARKED. */
  parked_question?: string | null;
  parked_phase?: string | null;
  parked_plan?: ImproveChangeoverPlan | null;
  parked_at?: string | null;
  /** The person's answer, once they have given one. */
  resolution?: string | null;
  resolved_at?: string | null;
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
  /**
   * Whether the program's packaged runner is the code the service would
   * package now. A program's runner is packaged once, when the program is
   * created, so a fix to the preset reaches only programs created afterwards.
   * Optional because an older automation service does not answer; absent is
   * read as "nothing to say", never as "out of date".
   */
  preset_code_is_current?: boolean;
  preset_code_digest?: string | null;
  service_preset_code_digest?: string | null;
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

/** Who a correction applies to. */
export type LessonScope = "user" | "project" | "runtime" | "surface";

/**
 * What produced a correction. Every one is something that already happens:
 * nothing asks the user to write a lesson.
 */
export type LessonTrigger =
  | "parked_resolution"
  | "change_requested"
  | "thumbs_down"
  | "comment"
  | "chat_instruction"
  | "rejected_approach";

/** Which stage of the pipeline let a repeated correction through. */
export type LessonFailureStage =
  | "never_captured"
  | "out_of_scope"
  | "not_injected"
  | "ignored"
  | "not_mechanisable";

export interface CaptureLessonRequest {
  scope: LessonScope;
  subject?: string | null;
  trigger: LessonTrigger;
  /** The user's words, verbatim. */
  text: string;
  why?: string | null;
  source?: Record<string, unknown> | null;
}

export interface Lesson {
  id: string;
  scope: LessonScope;
  subject: string | null;
  trigger: LessonTrigger;
  text: string;
  why: string | null;
  mechanised: boolean;
  check_ref: string | null;
  status: "active" | "retired";
  created_at: string;
  /** How many times this correction has had to be given again. */
  repeats: number;
}

export interface CaptureLessonResult {
  lesson: Lesson;
  /** True when this correction had already been given. */
  repeat: boolean;
  failed_stage: LessonFailureStage | null;
  failure_detail: string | null;
}

export interface LessonListResponse {
  lessons: Lesson[];
  total: number;
}
