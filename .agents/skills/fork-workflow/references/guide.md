# Fork Workflow Guide

## Checks on fork PRs and on the fork's `main`

Upstream workflows run unchanged on the fork. The fork has no secrets to give them. On 22 October 2026 it had 0 repository secrets, 0 organization secrets shared with it, and 0 environments. An unset secret expands to an empty string. So every job that needs one of upstream's secrets, or that writes to an upstream resource, fails here on every run, whatever the change. Recheck the counts before you rely on this:

```sh
gh api repos/zeroday-ninja/OpenHands/actions/secrets --jq .total_count
gh api repos/zeroday-ninja/OpenHands/actions/organization-secrets --jq .total_count
gh api repos/zeroday-ninja/OpenHands/environments --jq .total_count
```

| Check | Result on the fork | Why | What to do |
|---|---|---|---|
| `CI` (lint, tests, build) | Meaningful | Needs no secrets. | Must pass. Reproduce locally with the commands in `AGENTS.md`. |
| `Verify skill isolation` | Meaningful | Needs no secrets. | Must pass. A verify-skill change goes in its own PR. |
| `pr`, `CodeQL` | Meaningful | Needs no secrets. | Must pass. |
| `PR Description Check` | Fails on every agent-written PR | It requires a `HUMAN:` note and a `Fixes #` issue with the `ready-for-dev` label. The fork has no issues, and agents may not write `HUMAN:` unless asked. | Report the two errors verbatim. Do not edit `HUMAN:`. Do not invent an issue number. |
| `PR Artifacts` / `cleanup-after-merge` | Fails after every merge | `actions/checkout` gets an empty `token` (`Input required and not supplied: token`) because `OPENHANDS_BOT_GITHUB_PAT_PUBLIC` is unset. | Remove `.pr/` yourself before merge (see below). |
| `release` | Fails on every push to `main` | release-please needs a GitHub App (`Input required and not supplied: app-id`). | Ignore. The fork does not publish releases. |
| `Docker` (push to `main`) | Fails at the push step | `ghcr.io/openhands/agent-canvas` is upstream's registry (`denied: permission_denied`). The image still builds, so a build error above the push step is real. | Read the log above the push. Only the push failure is expected. |
| `Mock-LLM E2E Tests` | Often red on `main` | These are real test failures, not missing secrets. From 21 to 22 October 2026, every run on `main` that finished without being cancelled failed. Cancelled runs are not failures; skip them when you compare. | Before you blame your change, compare with the latest run on `main`: `gh run list --repo zeroday-ninja/OpenHands --workflow "Mock-LLM E2E Tests" --branch main --limit 5`. Report any failing spec that is not red on `main`. |

Read a failure before you classify it: `gh run view <id> --repo zeroday-ninja/OpenHands --log-failed`. A row in this table is only a starting point. If the log shows a different error, treat it as real.

## Stacked PRs

GitHub made stacked pull requests generally available on 6 October 2026. Use them for any new stack. They need `gh` 2.90.0 or later and the `gh stack` extension (`gh extension install github/gh-stack`). Every branch must be in the fork itself; cross-fork stacks are not supported.

```sh
gh stack init                         # first branch; trunk defaults to main
gh stack add <branch>                 # next layer on top
gh stack submit --remote origin       # push, open the PRs with the right bases, link them as a stack
gh stack sync --remote origin         # after main moves: fetch, cascade-rebase, push
gh stack merge --rebase               # only when the user asks
```

Run these from a clone whose `origin` is `zeroday-ninja/OpenHands`. `gh stack` has no `--repo` flag; `--remote` picks the remote.

When a lower PR in a linked stack merges, GitHub retargets the PRs above it to the stack's base. You do not edit bases by hand. `gh stack merge` is all-or-nothing: if any PR in the range cannot merge, none merge. Merge from the bottom up. To merge a stack through the API, use the asynchronous merge endpoint (`PUT /repos/{owner}/{repo}/pulls/{n}/merge-async`); the synchronous merge endpoint does not support stacks.

### Recovery: a chain that is not linked as a stack

PRs chained by hand (each based on the branch of the one below) are not a stack. GitHub retargets the upper PR to the lower PR's base when the lower PR's branch is deleted. #10 below shows that merging alone did not retarget it. The fork does not delete head branches on merge (`delete_branch_on_merge` is `false`), and `gh pr merge` deletes them only with `--delete-branch`.

This happened: #10 was based on #9's branch `feat/acp-usage-limit-failover`. #9 merged and its branch stayed. #10 was then merged into that dead branch, not `main`. #12 and #14 were needed to carry its commits to `main`.

If you find such a chain, link it: `gh stack link --remote origin <bottom> <next> ...` takes branches or PR numbers from bottom to top and reuses the open PRs. If you cannot link it, check the upper PR's base before every merge:

```sh
gh pr view <n> --repo zeroday-ninja/OpenHands --json baseRefName --jq .baseRefName
gh pr edit <n> --repo zeroday-ninja/OpenHands --base main   # if it is not main
```

## `.pr/` evidence

Upstream removes `.pr/` after merge with a bot PR. On the fork that job fails (see the table), so `.pr/` would stay on `main`. The pattern used here (commit `a73ded2`):

1. Link evidence from the PR body by full commit SHA, for example `https://github.com/zeroday-ninja/OpenHands/blob/<sha>/.pr/<file>`. Branch links break once the files are gone.
2. As the last commit on the branch, `git rm -r .pr/<your-dir>` with a message that names the SHA the evidence still lives at.

Remove only your PR's directory. `.pr/root-onboarding/` came from upstream `main`. Leave it for an upstream sync to remove.

## Taking an upstream release

The New Version tile's update merges the `v<version>` tag of `OpenHands/OpenHands` into the current branch. It aborts on conflict (`local-stack-runtime` guide, "Self-update and restart"). When it conflicts, do the merge by hand on its own branch, as #15 did for v1.29.0:

```sh
git fetch https://github.com/OpenHands/OpenHands.git tag v<version> --no-tags
git switch -c chore/merge-release-<version> main
git merge --no-ff v<version>
```

- Keep both sides where fork features and upstream changes overlap. In #15 the overlaps were `profile-field-support.ts`, the agent-settings dirty check and its test mocks, and the server-info type (`agent_canvas_control`).
- Do not raise `compatibility.minimumAgentServer` past the Agent Server the fork runs. #15 took `@openhands/typescript-client` 1.56.0 and kept the floor at 1.55.0.
- The same rules apply when you merge upstream `main` instead of a tag.
- Never hand-edit a release-please branch (`release.md`).

## Worktrees

A git worktree that symlinks `node_modules` to another checkout once got that symlink committed (#24). `.gitignore` now ignores a symlink of that name. Still, stage paths explicitly instead of `git add -A` in a worktree, and run `git status --short` before you commit.
