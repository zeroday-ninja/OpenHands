# fork-identity-guard

An OpenHands plugin for this fork. It stops an agent from making a commit that
records an author or committer email other than `tentpegbob@gmail.com`.

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

`hooks/hooks.json` registers a `PreToolUse` hook on the terminal tool. For each
`git` call in the command that writes a commit (`commit`, `cherry-pick`,
`revert`, `rebase`, `am`, `merge`), the hook does these steps:

- It asks git for the identity it would record (`git var GIT_AUTHOR_IDENT` and
  `GIT_COMMITTER_IDENT`). It runs this with the same `-C`, `-c` and `VAR=value`
  prefixes and repository config as the real command.
- It honours `--author`, and `--amend` without `--reset-author` (which keeps
  the old author).
- It exits with code 2, and a reason the agent sees, when an email differs.

Calls that write nothing (`--abort`, `--ff-only`, `--dry-run` and similar) and
all other commands are allowed.

## Limits

- The hook sees the agent-server environment, not variables exported earlier in
  the agent's terminal session. A `GIT_AUTHOR_EMAIL` exported in one command and
  used in a later one is not detected.
- Commits made inside `bash -c`, `$(...)`, scripts, or an editor are not parsed.
- It checks the email only, not the name.

## Changing the required address

Edit `--require-email` in `hooks/hooks.json`.

## Tests

```sh
python -m pytest .agents/plugins/fork-identity-guard/tests
```

The last test loads the plugin through `openhands.sdk`. It is skipped when the
SDK is not installed.
