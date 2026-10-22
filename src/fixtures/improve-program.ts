import {
  ImproveCycleStatus,
  ImproveVerdict,
  type ImproveCycle,
  type ImproveCycleListResponse,
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

const MOCK_CYCLES: ImproveCycle[] = [
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

export function mockImproveCyclePage(
  limit: number,
  offset: number,
): ImproveCycleListResponse {
  return {
    cycles: MOCK_CYCLES.slice(offset, offset + limit),
    total: MOCK_CYCLES.length,
  };
}
