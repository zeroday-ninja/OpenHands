---
name: fork-workflow
description: This skill should be used when working in the zeroday-ninja/OpenHands fork and the user asks to "open a PR", "stack a PR", "merge a PR", "why is CI red", "take the new upstream release", "merge v1.x from OpenHands/OpenHands", or "clean up .pr/", or when a check fails on a fork PR or on the fork's main.
---

# Fork Workflow

Ship changes through the `zeroday-ninja/OpenHands` fork without repeating its known mistakes. The fork's `origin` is `zeroday-ninja/OpenHands`. Its parent is `OpenHands/OpenHands`, and its default branch is `main`. Issues are disabled, `main` has no branch protection, and merged head branches are not deleted automatically.

## Workflow

1. Confirm you are in the fork. Run `gh api repos/zeroday-ninja/OpenHands --jq '{parent: .parent.full_name, has_issues, delete_branch_on_merge}'`. If `origin` points somewhere else, stop: this skill does not apply.
2. Open every PR with `--repo zeroday-ninja/OpenHands --base main`. This is local policy: PRs go to the fork, never upstream, so name the target repository explicitly instead of relying on `gh` defaults.
3. To stack PRs, use GitHub's stacked pull requests through the `gh stack` extension. Prefix every `gh stack` command with `GH_REPO=zeroday-ninja/OpenHands`. `--remote origin` alone does not keep its API calls off upstream: with an `upstream` remote, `gh stack` resolves to `OpenHands/OpenHands`. Use only the non-interactive forms in `references/guide.md`. Do not build a stack from plain PRs whose bases you edit by hand. Retarget by hand only to recover a chain that is not linked as a stack.
4. In the PR body, leave `HUMAN:` alone. Under `## Issue Number`, write `None. Issues are disabled on this fork.` The PR Description Check then fails. Report that as expected; do not try to make it pass.
5. Judge CI by the checks that can pass on the fork. Read `references/guide.md` before you call a red check your fault or call it noise.
6. If the PR committed `.pr/` evidence, the last commit before merge removes it. The fork's cleanup job cannot run. Link the evidence by the commit SHA that still contains it.
7. Merge only when the user asks. Use `gh pr merge <n> --repo zeroday-ninja/OpenHands --rebase` for a single PR, and `GH_REPO=zeroday-ninja/OpenHands gh stack merge --yes --rebase` from a branch of the stack for a stack, because `gh pr merge` cannot merge a stack. With `gh pr merge`, add `--delete-branch` unless another open PR uses the branch as its base.

## Reference

- **`references/guide.md`**: which fork checks fail and why, stacked PRs and the incident that recovery covers, `.pr/` cleanup, and taking an upstream release.
