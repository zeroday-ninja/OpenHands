---
name: fork-workflow
description: This skill should be used when working in the zeroday-ninja/OpenHands fork and the user asks to "open a PR", "stack a PR", "merge a PR", "why is CI red", "take the new upstream release", "merge v1.x from OpenHands/OpenHands", or "clean up .pr/", or when a check fails on a fork PR or on the fork's main.
---

# Fork Workflow

Ship changes through the `zeroday-ninja/OpenHands` fork without repeating its known mistakes. The fork's `origin` is `zeroday-ninja/OpenHands`. Its parent is `OpenHands/OpenHands`, and its default branch is `main`. Issues are disabled, `main` has no branch protection, and merged head branches are not deleted automatically.

## Workflow

1. Confirm you are in the fork. Run `gh api repos/zeroday-ninja/OpenHands --jq '{parent: .parent.full_name, has_issues, delete_branch_on_merge}'`. If `origin` points somewhere else, stop: this skill does not apply.
2. Open every PR with `--repo zeroday-ninja/OpenHands --base main`. Without `--repo`, `gh` offers the upstream parent.
3. If you stack PRs, retarget the upper PR to `main` *before* you merge the lower one. Fork branches are not deleted on merge, so GitHub never retargets the upper PR for you.
4. In the PR body, leave `HUMAN:` alone. Under `## Issue Number`, write `None. Issues are disabled on this fork.` The PR Description Check then fails. Report that as expected; do not try to make it pass.
5. Judge CI by the checks that can pass on the fork. Read `references/guide.md` before you call a red check your fault or call it noise.
6. If the PR committed `.pr/` evidence, the last commit before merge removes it. The fork's cleanup job cannot run. Link the evidence by the commit SHA that still contains it.
7. Merge with `gh pr merge <n> --repo zeroday-ninja/OpenHands --rebase` only when the user asks. Add `--delete-branch` unless another open PR uses the branch as its base.

## Reference

- **`references/guide.md`**: which fork checks fail and why, the stacked-PR incident, `.pr/` cleanup, and taking an upstream release.
