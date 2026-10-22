# Fork Workflow Guide

## Checks on fork PRs and on the fork's `main`

Upstream workflows run unchanged on the fork. On 22 October 2026 the fork had 0 repository secrets, 0 organization secrets shared with it, and 0 environments. Recheck the counts before you rely on the table:

```sh
gh api repos/zeroday-ninja/OpenHands/actions/secrets --jq .total_count
gh api repos/zeroday-ninja/OpenHands/actions/organization-secrets --jq .total_count
gh api repos/zeroday-ninja/OpenHands/environments --jq .total_count
```

| Check | Result on the fork | Why | What to do |
|---|---|---|---|
| `CI`, `Verify skill isolation`, `pr`, `CodeQL` | Meaningful | They passed on fork PR #29. | Must pass. Reproduce `CI` locally with the commands in `AGENTS.md`. |
| `PR Description Check` | Fails on agent-written PRs | `.github/scripts/check_pr_description.py` requires a `HUMAN:` note and a `Fixes #` issue with the `ready-for-dev` label. The fork has no issues, and agents may not write `HUMAN:` unless asked. | Report the errors verbatim. Do not edit `HUMAN:`. Do not invent an issue number. |
| `PR Artifacts` / `cleanup-after-merge` | Fails after a merge | `actions/checkout` gets no token (`Input required and not supplied: token`) because `OPENHANDS_BOT_GITHUB_PAT_PUBLIC` is unset. | Remove `.pr/` yourself before merge (see below). |
| `release` | Fails on every push to `main` | `Input required and not supplied: app-id`. | Ignore. The fork does not publish releases. |
| `Docker` (push to `main`) | Fails in `Build & Push` | The push to `ghcr.io/openhands/agent-canvas`, upstream's registry, is refused (`denied: permission_denied`). | Read the log. Only the push error is expected; any error before it is real. |
| `Mock-LLM E2E Tests` | Red on `main` | Its logs show test assertion failures. On 22 October 2026, of the last 28 runs on `main`, 16 failed, 12 were cancelled and none succeeded. Cancelled runs are not failures. | Compare with the latest run on `main`: `gh run list --repo zeroday-ninja/OpenHands --workflow "Mock-LLM E2E Tests" --branch main --limit 5`. Report any failing spec that is not red on `main`. |

Read a failure before you classify it: `gh run view <id> --repo zeroday-ninja/OpenHands --log-failed`. If the log shows a different error from the table, treat it as real.

## Stacked PRs: do not stack

Stacking is not safe to automate in this fork yet. Base every PR on `main`.

This is why. #10 was based on #9's branch `feat/acp-usage-limit-failover`. #9 merged and its branch stayed, because `delete_branch_on_merge` is `false`. #10 was then merged into that branch, not `main`. #12 tried to carry it to `main` and was closed; #14 did it.

Before you merge, list open PRs whose base is not `main`. If this prints anything, stop and ask the user:

```sh
gh api --paginate 'repos/zeroday-ninja/OpenHands/pulls?state=open&per_page=100' --jq '.[]|select(.base.ref!="main")|.number'
```

## `.pr/` evidence

On the fork the `cleanup-after-merge` job fails (see the table), so `.pr/` would stay on `main`. The pattern used here (commit `a73ded2`):

1. Link evidence from the PR body by full commit SHA, for example `https://github.com/zeroday-ninja/OpenHands/blob/<sha>/.pr/<file>`. Branch links break once the files are gone.
2. As the last commit on the branch, `git rm` the files your PR added under `.pr/`, with a message that names the SHA the evidence still lives at. Check the list first with `git rm -n`.

Remove only what your PR added. Other files under `.pr/` are not yours.

## Taking an upstream release

`scripts/self-update.mjs` merges a release tag of `OpenHands/OpenHands` into the current branch and aborts on conflict. When it conflicts, do the merge by hand on its own branch. Fetch the tag into `FETCH_HEAD` and merge that, as `self-update.mjs` does. Do not merge the local `v<version>` tag: if one already exists, the fetch does not move it.

```sh
git fetch https://github.com/OpenHands/OpenHands.git refs/tags/v<version> --no-tags
git switch -c chore/merge-release-<version> main
git merge --no-ff FETCH_HEAD
```

Never hand-edit a release-please branch (`AGENTS.md`, "Releases").
