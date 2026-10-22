---
name: fork-workflow
description: This skill should be used when working in the zeroday-ninja/OpenHands fork and the user asks to "open a PR", "why is CI red", or "clean up .pr/", or when a check fails on a fork PR or on the fork's main.
---

# Fork Workflow

Facts about the `zeroday-ninja/OpenHands` fork, checked on 22 October 2026. Its parent is `OpenHands/OpenHands` and its default branch is `main`. Issues are disabled. `main` has no branch protection. Merged head branches are not deleted (`delete_branch_on_merge` is `false`). The fork has no repository secrets, no organization secrets and no environments.

## Rules

- Pass `--repo zeroday-ninja/OpenHands --base main` to every `gh pr create`. This is local policy: PRs go to the fork, never upstream.
- Leave the `HUMAN:` section of a PR body to the user. Under `## Issue Number`, write `None. Issues are disabled on this fork.`
- If your PR added files under `.pr/`, remove them by hand in the last commit before merge, and link the evidence by the commit SHA that still has it. Nothing removes them automatically here (see `cleanup-after-merge` below). Remove only files your PR added.
- Merge only when the user asks.

## Checks that fail on the fork

| Check                                  | Failure                | Cause                                                                                                                               |
| -------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `PR Description Check`                 | Every agent-written PR | No `HUMAN:` note, and no `Fixes #` issue with the `ready-for-dev` label. Both are expected; report them, do not work around them.   |
| `PR Artifacts` / `cleanup-after-merge` | On merge               | `Input required and not supplied: token`. `OPENHANDS_BOT_GITHUB_PAT_PUBLIC` is unset.                                               |
| `release`                              | On push to `main`      | `Input required and not supplied: app-id`.                                                                                          |
| `Docker` / `Build & Push`              | On push to `main`      | Pushing to `ghcr.io/openhands/agent-canvas`, upstream's registry, is `denied: permission_denied`. An error before the push is real. |
| `Mock-LLM E2E Tests`                   | Red on `main`          | The latest run on `main` failed on Playwright assertions. Compare a PR's failing specs with the latest run on `main`.               |

Read a failure before classifying it: `gh run view <id> --repo zeroday-ninja/OpenHands --log-failed`. An error not in this table is real.

## Not documented here

- Stacking PRs is a hazard: a PR based on a merged branch merges into that leftover branch, not `main` (#10 did). No stacking procedure is given because none could be verified.
- Merging an upstream release by hand is a hazard when `scripts/self-update.mjs` hits a conflict. No procedure is given because none could be verified.
