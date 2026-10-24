import {
  ImproveCycleStatus,
  ImproveVerdict,
  type ImproveCycle,
  type ImproveCycleListResponse,
  type ImproveCycleRepository,
  type ImproveProgramConfig,
  type ImproveRotationResponse,
} from "#/types/improve";

/**
 * Mock-mode data for an improvement program: a three-repository rotation and
 * a history that reaches each verdict the dashboard renders differently —
 * accepted, changes requested, `SINGLE_RUNTIME` (nobody else was available to
 * review) and `NO_CHANGE` (nothing was changed on purpose).
 *
 * Its SOUL.md proposals cover both states the dashboard has for one: a
 * preference the user has not accepted yet, and one the SOUL.md this mock
 * serves (`DEFAULT_MOCK_SOUL`) already states.
 *
 * Lives under `src/fixtures/` because MSW handlers are part of the production
 * mock build; `__tests__/` is excluded from the Docker build context.
 */
export const MOCK_IMPROVE_AUTOMATION_ID =
  "11111111-2222-3333-4444-555555555555";

export const MOCK_IMPROVE_CONFIG: ImproveProgramConfig = {
  builder_profile_id: "aaaaaaaa-0000-0000-0000-000000000001",
  rotate_builder: [],
  reviewer_profile_ids: [],
  repository_source: "git_sync",
  repositories: [],
  repository_labels: [],
  branch_prefix: "improve/",
  max_changed_files: 20,
  open_pr: true,
  focus: null,
};

const REPOSITORIES = [
  {
    label: "agent-canvas",
    url: "https://github.com/OpenHands/OpenHands",
    ref: "main",
    index: 0,
    remote_id: "bbbbbbbb-0000-0000-0000-000000000001",
  },
  {
    label: "software-agent-sdk",
    url: "https://github.com/OpenHands/software-agent-sdk",
    ref: null,
    index: 1,
    remote_id: "bbbbbbbb-0000-0000-0000-000000000002",
  },
  {
    label: "automation",
    url: "https://github.com/OpenHands/automation",
    ref: null,
    index: 2,
    remote_id: "bbbbbbbb-0000-0000-0000-000000000003",
  },
] as const;

/**
 * A cycle waiting for a person, with the changeover plan the question cannot
 * be answered without.
 *
 * The empty `consumers` and `sequence` entries are the sentences the service
 * writes when the builder supplied neither: a plan with a blank rollback reads
 * as a change that needs no rollback, so absence is stated rather than left
 * out. The mock carries them for the same reason the real one does.
 */
export const MOCK_PARKED_CYCLE: ImproveCycle = {
  id: "cccccccc-0000-0000-0000-000000000009",
  automation_id: MOCK_IMPROVE_AUTOMATION_ID,
  run_id: "dddddddd-0000-0000-0000-000000000009",
  status: ImproveCycleStatus.PARKED,
  verdict: ImproveVerdict.ACCEPTED,
  repository: REPOSITORIES[0],
  builder_profile_id: MOCK_IMPROVE_CONFIG.builder_profile_id,
  builder_runtime: "claude-code",
  builder_conversation_id: "conv-improve-9",
  summary:
    "Renamed the conversation socket's event envelope so every event carries its own kind.",
  branch: "improve/event-envelope",
  pr_url: "https://github.com/OpenHands/OpenHands/pull/412",
  sources: [],
  reviews: [],
  soul_suggestions: [],
  change_class: "breaking",
  claimed_change_class: "breaking",
  gate_decisions: [
    {
      phase: "publish",
      route: "escalate",
      trigger: "the diff is a breaking change",
      rationale: "A wire contract changed, which is never mine to publish.",
      change_class: "breaking",
      at: "2026-10-24T07:40:00Z",
    },
  ],
  judge_attestation: null,
  parked_phase: "publish",
  parked_question:
    "This renames the conversation socket's event envelope. Publish it now, or wait for the client release?",
  parked_plan: {
    breaks: ["removed_export in src/types/events.ts: -export type Envelope"],
    consumers: ["The builder did not say who depends on this."],
    sequence: ["The builder proposed no changeover sequence."],
    rollback:
      "Not stated by the builder. Reverting the branch `improve/event-envelope` is the fallback, which only works while nothing depends on it yet.",
    branch: "improve/event-envelope",
  },
  parked_at: "2026-10-24T07:40:00Z",
  resolution: null,
  resolved_at: null,
  error: null,
  created_at: "2026-10-24T07:10:00Z",
  updated_at: "2026-10-24T07:40:00Z",
  completed_at: null,
};

const MOCK_CYCLES: ImproveCycle[] = [
  // Additive and accepted, so it merged itself without being asked. Mock mode
  // has to carry that case: it is the one the user never confirmed, and the
  // card is the only place they find out it happened.
  {
    id: "cccccccc-0000-0000-0000-000000000004",
    automation_id: MOCK_IMPROVE_AUTOMATION_ID,
    run_id: "dddddddd-0000-0000-0000-000000000004",
    status: ImproveCycleStatus.COMPLETED,
    verdict: ImproveVerdict.ACCEPTED,
    repository: REPOSITORIES[2],
    builder_profile_id: MOCK_IMPROVE_CONFIG.builder_profile_id,
    builder_runtime: "codex",
    builder_conversation_id: "conv-improve-4",
    summary:
      "Recorded the runtime each reviewer finished on, so a review that failed over is not filed under the runtime that started it.",
    branch: "improve/reviewer-runtime",
    pr_url: "https://github.com/OpenHands/automation/pull/57",
    merged_at: "2026-10-23T09:14:00Z",
    merge_commit_sha: "9c1f0a7b4d2e6358af0119e73c5b8d2a4f6e0b31",
    change_class: "additive",
    sources: [
      {
        url: "https://agentclientprotocol.com/protocol/schema",
        title: "Agent Client Protocol schema",
        note: "The protocol carries no credit balance, so a switch is the only signal.",
      },
    ],
    reviews: [],
    soul_suggestions: [],
    error: null,
    created_at: "2026-10-23T08:40:00Z",
    updated_at: "2026-10-23T09:14:00Z",
    completed_at: "2026-10-23T09:14:00Z",
  },
  {
    id: "cccccccc-0000-0000-0000-000000000003",
    automation_id: MOCK_IMPROVE_AUTOMATION_ID,
    run_id: "dddddddd-0000-0000-0000-000000000003",
    status: ImproveCycleStatus.REVIEWING,
    verdict: null,
    repository: REPOSITORIES[1],
    builder_profile_id: MOCK_IMPROVE_CONFIG.builder_profile_id,
    builder_runtime: "claude-code",
    builder_conversation_id: "conv-improve-3",
    summary:
      "Narrowed the event-store dedup to the id set instead of re-sorting the whole list on every append.",
    branch: "improve/event-store-dedup",
    pr_url: null,
    sources: [
      {
        url: "https://react.dev/reference/react/useSyncExternalStore",
        title: "useSyncExternalStore",
        note: "Confirms the store must return a stable snapshot between renders.",
      },
    ],
    reviews: [],
    soul_suggestions: [
      {
        text: "Tell me which check you ran before you say a change is safe.",
        why: "This cycle had to guess whether the repository's own test command counted as verification.",
      },
      // Already stated in the built-in SOUL.md this mock serves, so the
      // dashboard shows it as added rather than offering it again.
      {
        text: "Every behavioral change needs a test that fails without it.",
        why: "The project's contributor guide enforces it, and your standing preferences already agree.",
      },
    ],
    error: null,
    created_at: "2026-10-22T06:10:00Z",
    updated_at: "2026-10-22T06:40:00Z",
    completed_at: null,
  },
  {
    id: "cccccccc-0000-0000-0000-000000000002",
    automation_id: MOCK_IMPROVE_AUTOMATION_ID,
    run_id: "dddddddd-0000-0000-0000-000000000002",
    status: ImproveCycleStatus.COMPLETED,
    verdict: ImproveVerdict.SINGLE_RUNTIME,
    repository: REPOSITORIES[0],
    builder_profile_id: MOCK_IMPROVE_CONFIG.builder_profile_id,
    builder_runtime: "codex",
    builder_conversation_id: "conv-improve-2",
    summary:
      "Added the missing aria-label to the conversation panel's new-thread picker.",
    branch: "improve/new-thread-picker-label",
    pr_url: "https://github.com/OpenHands/OpenHands/pull/9001",
    sources: [
      {
        url: "https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/",
        title: "ARIA menu button pattern",
        note: "The icon-only trigger needs an accessible name of its own.",
      },
    ],
    reviews: [],
    soul_suggestions: [],
    error: null,
    created_at: "2026-10-21T06:10:00Z",
    updated_at: "2026-10-21T07:02:00Z",
    completed_at: "2026-10-21T07:02:00Z",
  },
  {
    id: "cccccccc-0000-0000-0000-000000000001",
    automation_id: MOCK_IMPROVE_AUTOMATION_ID,
    run_id: "dddddddd-0000-0000-0000-000000000001",
    status: ImproveCycleStatus.COMPLETED,
    verdict: ImproveVerdict.CHANGES_REQUESTED,
    repository: REPOSITORIES[2],
    builder_profile_id: MOCK_IMPROVE_CONFIG.builder_profile_id,
    builder_runtime: "claude-code",
    builder_conversation_id: "conv-improve-1",
    summary:
      "Moved the git-sync dirty flag onto the remote so an unassigned automation is re-adopted when its repository returns.",
    branch: "improve/git-sync-dirty-flag",
    pr_url: "https://github.com/OpenHands/automation/pull/42",
    sources: [
      {
        url: "https://docs.sqlalchemy.org/en/20/orm/session_transaction.html",
        title: "SQLAlchemy session transactions",
        note: "Row locks are what stop two overlapping runs claiming one repository.",
      },
      {
        url: "https://git-scm.com/docs/git-ls-remote",
        title: "git ls-remote",
        note: "The reachability check the service runs before saving a remote.",
      },
    ],
    reviews: [
      {
        profile_id: "aaaaaaaa-0000-0000-0000-000000000002",
        profile_name: "Codex reviewer",
        runtime: "codex",
        conversation_id: "conv-improve-1-review-codex",
        verdict: ImproveVerdict.CHANGES_REQUESTED,
        summary:
          "The flag is set inside the same transaction as the claim, so a rolled-back claim leaves it set.",
        concerns: [
          "mark_git_sync_dirty runs before the claim commits.",
          "No coverage for the rollback path.",
        ],
        stale_sources: ["https://git-scm.com/docs/git-ls-remote"],
        updates_checked:
          "Compared against git 2.47, the current release; nothing in its " +
          "changelog or the ls-remote docs supersedes this approach.",
      },
    ],
    soul_suggestions: [
      {
        text: "Open a pull request against my fork, never the upstream repository.",
        why: "Every branch this cycle looked at was pushed to a fork first, which your SOUL.md does not mention.",
      },
    ],
    error: null,
    created_at: "2026-10-20T06:10:00Z",
    updated_at: "2026-10-20T07:31:00Z",
    completed_at: "2026-10-20T07:31:00Z",
  },
];

export const MOCK_IMPROVE_ROTATION: ImproveRotationResponse = {
  repositories: [...REPOSITORIES],
  // The newest cycle took index 1, so index 2 is what the next run takes.
  next_index: 2,
  last_cycle: MOCK_CYCLES[0],
  config: MOCK_IMPROVE_CONFIG,
};

/**
 * The rotation a configuration resolves to, the way the service resolves it
 * when a program's configuration is replaced: the explicit list in order, or
 * the synced repositories narrowed by the label filter.
 */
export function mockImproveRotationFor(
  config: ImproveProgramConfig,
): ImproveRotationResponse {
  const repositories: ImproveCycleRepository[] =
    config.repository_source === "explicit"
      ? config.repositories.map((repository, index) => ({
          label: repository.label,
          url: repository.url,
          ref: repository.ref ?? null,
          index,
          remote_id: null,
        }))
      : REPOSITORIES.filter(
          (repository) =>
            config.repository_labels.length === 0 ||
            config.repository_labels.includes(repository.label),
        ).map((repository, index) => ({ ...repository, index }));

  return {
    repositories,
    next_index: repositories.length === 0 ? null : repositories.length - 1,
    last_cycle: MOCK_CYCLES[0],
    config,
  };
}

export function mockImproveCyclePage(
  limit: number,
  offset: number,
): ImproveCycleListResponse {
  return {
    cycles: MOCK_CYCLES.slice(offset, offset + limit),
    total: MOCK_CYCLES.length,
  };
}
