# fork-identity-guard

An OpenHands plugin for this fork. Before an agent's terminal command runs, it
checks the git calls in it that write commits. It blocks the command when one
of them would record an author or committer email other than
`tentpegbob@gmail.com`.

It is a best-effort check, not a guarantee. It judges the repository as it is
before the command starts, and it reads only the git calls it can see in the
command text. The [Limits](#limits) section lists what it misses. Check
`git log --format='%ae %ce'` before you push.

## Why

This machine has no global git identity on purpose, and a wrong address has
already had to be scrubbed from this fork's history. Agents are told to pass
the identity per command (`git -c user.name=... -c user.email=...`). This hook
turns that instruction into a check that runs before the command does.

## How it loads

The SDK discovers project plugins in `.agents/plugins/` under a conversation's
working directory and its git root, and merges their `hooks/hooks.json` into
the conversation. Any conversation working inside this repository gets the
hook. You do not need to install anything.

## What it checks

`hooks/hooks.json` registers a `PreToolUse` hook on the terminal tool. The hook
joins `\`-continued lines, splits the command on shell operators, looks past a
leading reserved word (`if`, `then`, `do`, `!`, `{` and similar) and finds each
`git` call that writes a commit object:

- `commit`, `commit-tree`, `merge`, `pull` and `revert`, whose author and
  committer both come from the current identity;
- `stash` (bare, `push`, `save` or `create`), because a stash entry is a commit;
- `notes` (`add`, `append`, `copy`, `edit`, `merge`, `remove` or `prune`),
  because notes are stored as commits;
- `cherry-pick`, `rebase` and `am`, which keep each replayed commit's original
  author, so only the committer is checked.

For each of these calls, the hook does these steps:

- It asks git for the identity it would record (`git var GIT_AUTHOR_IDENT` and
  `GIT_COMMITTER_IDENT`). It runs this with the same `cd`, `-C`, `-c` and
  `VAR=value` prefixes and repository config as the real command.
- For `git commit` it follows git's own author precedence: `--author`, then
  `--reset-author`, then the commit that `-C`/`--reuse-message` or
  `-c`/`--reedit-message` reuses, then `HEAD` for `--amend`. It reads options
  the way git does, including abbreviations (`--reuse`), clustered short
  options (`-qC HEAD`) and values that look like options (`-m --dry-run`).
- It exits with code 2, and a reason the agent sees, when an email differs.

Calls that write nothing (`--abort`, `--ff-only`, `--dry-run`, `stash list` and
similar) and all other commands are allowed.

## Limits

These commands can still record another email without being blocked:

- **An earlier segment of the same command.** The hook runs once, before any
  of the command runs. In `git config user.email X && git commit`, or
  `export GIT_AUTHOR_EMAIL=X && git commit`, the commit is judged against the
  state before the first segment ran. A hook that inspects a command before it
  runs cannot know what an earlier segment will change. Pinning `-c user.email`
  on the commit defeats an earlier `git config user.email`, but not an earlier
  `export GIT_AUTHOR_EMAIL` or `git config author.email`, which outrank it.
- **Earlier commands.** The hook sees the agent-server environment, not
  variables exported in the agent's terminal session by a previous command.
- **Hidden git calls.** Commits made inside `bash -c`, `$(...)`, scripts, git
  aliases, editors, `rebase --exec`, or text sent to a running process
  (`is_input`) are not parsed. Neither is git started by another command, such
  as `command`, `exec`, `time`, `timeout`, `nice`, `sudo`, `xargs` or `env`
  with options (`env -u X git commit`).
- **Replayed authors.** `cherry-pick`, `rebase` and `am`, and a `git commit`
  that concludes one of them, keep the original author, which is not checked.
- **Other objects and writers.** Annotated tags (the tagger), `git replace`,
  `filter-branch`, `fast-import` and other plumbing are not covered.
- **Fail-open.** If `python3` or the script cannot be found, the command runs.
- It checks the email only, not the name.

The test `test_known_limit_an_earlier_segment_can_change_the_identity_unseen`
pins the first limit against real commits, so the README and the hook cannot
drift apart silently.

## Changing the required address

Edit `--require-email` in `hooks/hooks.json`.

## Tests

```sh
python -m pytest .agents/plugins/fork-identity-guard/tests
```

The tests run the real hook against temporary repositories. Each bypass
regression also runs the allowed command and asserts on the commit object git
wrote. The last test loads the plugin through `openhands.sdk`. It is skipped
when the SDK is not installed.
