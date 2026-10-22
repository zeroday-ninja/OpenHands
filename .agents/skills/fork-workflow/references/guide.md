# Fork Workflow Guide

## Checks on fork PRs and on the fork's `main`

Upstream workflows run unchanged on the fork. The fork has no secrets to give them. On 22 October 2026 it had 0 repository secrets, 0 organization secrets shared with it, and 0 environments. So every job that needs one of upstream's secrets, or that writes to an upstream resource, fails here on every run, whatever the change. Recheck the counts before you rely on this:

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
| `PR Artifacts` / `cleanup-after-merge` | Fails after a merge | `actions/checkout` gets an empty `token` (`Input required and not supplied: token`) because `OPENHANDS_BOT_GITHUB_PAT_PUBLIC` is unset. | Remove `.pr/` yourself before merge (see below). |
| `release` | Fails on every push to `main` | release-please needs a GitHub App (`Input required and not supplied: app-id`). | Ignore. The fork does not publish releases. |
| `Docker` (push to `main`) | Fails in `Build & Push` | The push to `ghcr.io/openhands/agent-canvas`, upstream's registry, is refused (`denied: permission_denied`). | Read the log. Only the push error is expected; any error before it is real. |
| `Mock-LLM E2E Tests` | Often red on `main` | These are real test failures, not missing secrets. On 22 October 2026, none of the last 28 runs on `main` (from 17 October) succeeded: 16 failed and 12 were cancelled. Cancelled runs are not failures; skip them when you compare. | Before you blame your change, compare with the latest run on `main`: `gh run list --repo zeroday-ninja/OpenHands --workflow "Mock-LLM E2E Tests" --branch main --limit 5`. Report any failing spec that is not red on `main`. |

Read a failure before you classify it: `gh run view <id> --repo zeroday-ninja/OpenHands --log-failed`. A row in this table is only a starting point. If the log shows a different error, treat it as real.

## Stacked PRs: do not stack

Stacking is not safe to automate in this fork yet. No stacked workflow has been run end to end here, so none is described. Base every PR on `main`.

This is why. #10 was based on #9's branch `feat/acp-usage-limit-failover`. #9 merged and its branch stayed, because the fork does not delete head branches on merge (`delete_branch_on_merge` is `false`). #10 was then merged into that branch, not `main`. #14 carried its commits to `main`; #12 tried first and was closed.

Before you merge, list open PRs whose base is not `main`. If this prints anything, stop and ask the user:

```sh
gh pr list --repo zeroday-ninja/OpenHands --state open --json number,baseRefName --jq '.[]|select(.baseRefName!="main")|.number'
```

## `.pr/` evidence

Upstream removes `.pr/` after merge with a bot PR. On the fork that job fails (see the table), so `.pr/` would stay on `main`. The pattern used here (commit `a73ded2`):

1. Link evidence from the PR body by full commit SHA, for example `https://github.com/zeroday-ninja/OpenHands/blob/<sha>/.pr/<file>`. Branch links break once the files are gone.
2. As the last commit on the branch, `git rm` the files your PR added under `.pr/`, with a message that names the SHA the evidence still lives at. Check the list first with `git rm -n`.

Remove only what your PR added. Other files under `.pr/` are not yours.

## Taking an upstream release

The New Version tile's update merges the `v<version>` tag of `OpenHands/OpenHands` into the current branch. It aborts on conflict (`local-stack-runtime` guide, "Self-update and restart"). When it conflicts, do the merge by hand on its own branch, as #15 did for v1.29.0:

```sh
git fetch https://github.com/OpenHands/OpenHands.git tag v<version> --no-tags
git switch -c chore/merge-release-<version> main
git merge --no-ff v<version>
```

- Keep both sides where fork features and upstream changes overlap. In #15 the conflicts were `profile-field-support.ts`, the agent-settings dirty check and its test, and the server-info type (`agent_canvas_control`).
- Never hand-edit a release-please branch (`release.md`).

## Worktrees

A git worktree that symlinks `node_modules` to another checkout once got that symlink committed (#24). `.gitignore` now ignores a symlink of that name. Still, stage paths explicitly instead of `git add -A` in a worktree, and run `git status --short` before you commit.
