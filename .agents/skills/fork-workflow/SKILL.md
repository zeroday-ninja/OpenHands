---
name: fork-workflow
description: This skill should be used when origin is zeroday-ninja/OpenHands and the user asks to "open a PR on the fork", "write the PR description", "is this check failure expected", "why is PR Description Check failing", "why did release or Docker fail on main", "remove the .pr/ evidence before merge", or "merge this PR", or when a check fails on a fork PR or on the fork's main.
---

# Fork Workflow

Ship changes through the `zeroday-ninja/OpenHands` fork without repeating its known mistakes. Its parent is `OpenHands/OpenHands` and its default branch is `main`. On 22 October 2026, issues were disabled, `main` had no branch protection, and merged head branches were not deleted (`delete_branch_on_merge` was `false`).

## Workflow

1. Confirm you are in the fork. If `origin` is not `zeroday-ninja/OpenHands`, stop: this skill does not apply. To recheck the settings above, run the commands in `references/guide.md`.
2. Pass `--repo zeroday-ninja/OpenHands --base main` to every `gh pr create`. This is local policy: PRs go to the fork, never upstream.
3. In the PR body, leave the `HUMAN:` section to the user. Under `## Issue Number`, write `None. Issues are disabled on this fork.` The PR Description Check then fails. Report that as expected; do not work around it.
4. Before you call a red check your fault or call it noise, read the check table in `references/guide.md`. Read the failing log first: `gh run view <id> --repo zeroday-ninja/OpenHands --log-failed`. An error not in the table is real.
5. If your PR added files under `.pr/`, remove them in the last commit before merge. Nothing removes them automatically on the fork.
6. Merge only when the user asks.

## Reference

- **`references/guide.md`**: commands to recheck the fork's settings and secrets, which checks fail on the fork and why, the Mock-LLM baseline on `main`, `.pr/` evidence, and the hazards this skill gives no procedure for.
