# Fork Workflow Guide

## Recheck the fork before relying on this guide

Everything below was observed on 22 October 2026. Recheck it when it matters, because the user can change any of it.

Repository settings. On 22 October 2026 this printed parent `OpenHands/OpenHands`, default branch `main`, `has_issues: false` and `delete_branch_on_merge: false`:

```sh
gh api repos/zeroday-ninja/OpenHands --jq '{parent: .parent.full_name, default_branch, has_issues, delete_branch_on_merge}'
```

Branch protection. On 22 October 2026 this failed with `Branch not protected (HTTP 404)`:

```sh
gh api repos/zeroday-ninja/OpenHands/branches/main/protection
```

Secrets. On 22 October 2026 each of these printed `0`. The check table depends on them: if a count is no longer `0`, the failures it blames on missing secrets may have stopped.

```sh
gh api repos/zeroday-ninja/OpenHands/actions/secrets --jq .total_count
gh api repos/zeroday-ninja/OpenHands/actions/organization-secrets --jq .total_count
gh api repos/zeroday-ninja/OpenHands/environments --jq .total_count
```

## Checks on fork PRs and on the fork's `main`

Upstream workflows run unchanged on the fork.

| Check                                          | Result on the fork              | Why                                                                                                                                                                                                               | What to do                                                                                   |
| ---------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `CI`, `Verify skill isolation`, `pr`, `CodeQL` | Meaningful                      | They passed on fork PR #29.                                                                                                                                                                                       | Must pass. Reproduce `CI` locally with the commands in `AGENTS.md`.                          |
| `PR Description Check`                         | Fails on every agent-written PR | `.github/scripts/check_pr_description.py` requires a human note under `HUMAN:` and a `Fixes #` issue with the `ready-for-dev` label. Issues are disabled, and agents may not write `HUMAN:` unless the user asks. | Report both errors verbatim. Do not edit `HUMAN:`. Do not invent an issue number.            |
| `PR Artifacts` / `cleanup-after-merge`         | Fails after a merge             | `Input required and not supplied: token`. The job checks out with `OPENHANDS_BOT_GITHUB_PAT_PUBLIC`, which is unset.                                                                                              | Remove `.pr/` yourself before merge (see below).                                             |
| `release`                                      | Fails on push to `main`         | `Input required and not supplied: app-id`.                                                                                                                                                                        | Ignore. The fork does not publish releases.                                                  |
| `Docker` / `Build & Push`                      | Fails on push to `main`         | The push to `ghcr.io/openhands/agent-canvas`, upstream's registry, is refused with `denied: permission_denied`.                                                                                                   | Only the push error is expected. Any error before the push is real.                          |
| `Mock-LLM E2E Tests`                           | Red on `main`                   | The latest completed run on `main` (39784836347) failed on Playwright assertions.                                                                                                                                 | Compare with `main` (see below). Report any failing spec that is not also failing on `main`. |

### Mock-LLM baseline on `main`

List the latest runs on `main`. Cancelled runs are not failures; compare against the newest run whose conclusion is `failure` or `success`.

```sh
gh run list --repo zeroday-ninja/OpenHands --workflow "Mock-LLM E2E Tests" --branch main --limit 5
gh run view <id> --repo zeroday-ninja/OpenHands --log-failed
```

## `.pr/` evidence

The `cleanup-after-merge` job fails on the fork, so `.pr/` files would stay on `main`. Commit `a73ded2` shows the fix: the last commit on the branch removes the evidence, and its message names the commit SHA where the evidence still lives. Link evidence from the PR body by that full SHA, not by branch name, because branch links break once the files are gone.

Remove only files your PR added. Other files under `.pr/` are not yours.

## Hazards with no procedure here

- **Stacked PRs.** A PR based on a merged branch merges into that leftover branch, not `main`, because merged branches are not deleted. #10 was based on #9's branch, was merged into it after #9 landed, and needed #14 to reach `main`. No stacking procedure is given, because none could be verified on the fork.
- **Upstream releases.** `scripts/self-update.mjs` merges an `OpenHands/OpenHands` release tag and aborts on conflict. No manual merge procedure is given, because none could be verified on the fork.

Never hand-edit a release-please branch (`AGENTS.md`, "Releases").
