#!/usr/bin/env python3
"""PreToolUse hook: refuse a git command that would record the wrong email.

The OpenHands hook executor sends the pending tool call as JSON on stdin and
treats exit code 2 as "block". This script finds every git invocation in a
terminal command that creates commits, asks git itself which author and
committer identity that invocation would record (honouring `-c user.email=`,
`-C`, `VAR=value` prefixes, repository config and `--author`), and blocks the
call when either email differs from the one this fork requires.

Anything it cannot recognise as a commit-creating git call is allowed: the hook
must never stand between the agent and unrelated commands.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import subprocess
import sys
from dataclasses import dataclass, field

BLOCK_EXIT_CODE = 2

# Subcommands that write a commit object. For `commit` both identities are
# checked; the others keep the original author and only record a committer.
AUTHORING_SUBCOMMANDS = {"commit"}
COMMITTING_SUBCOMMANDS = {"cherry-pick", "revert", "rebase", "am", "merge"}

# Arguments after which these subcommands write nothing.
NON_WRITING_ARGS = {
    "--abort",
    "--quit",
    "--ff-only",
    "--edit-todo",
    "--show-current-patch",
    "--dry-run",
    "-h",
    "--help",
}

# git global options that take a separate value (`git -C dir commit`).
GLOBAL_OPTS_WITH_VALUE = {
    "-c",
    "-C",
    "--git-dir",
    "--work-tree",
    "--namespace",
    "--exec-path",
    "--config-env",
}

CONTROL_OPERATORS = {"&&", "||", ";", ";;", "|", "|&", "&", "(", ")", "\n"}
ASSIGNMENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")
EMAIL_RE = re.compile(r"<([^<>]*)>")


@dataclass
class GitCall:
    cwd: str
    env: dict[str, str]
    global_opts: list[str]
    subcommand: str
    args: list[str] = field(default_factory=list)


def split_segments(command: str) -> list[list[str]]:
    """Split a shell command into simple commands on control operators."""
    lexer = shlex.shlex(command, posix=True, punctuation_chars="();<>|&\n")
    lexer.whitespace = " \t\r"
    lexer.whitespace_split = True
    segments: list[list[str]] = [[]]
    for token in lexer:
        if token in CONTROL_OPERATORS:
            segments.append([])
        else:
            segments[-1].append(token)
    return [segment for segment in segments if segment]


def find_git_calls(command: str, cwd: str) -> list[GitCall]:
    calls: list[GitCall] = []
    for argv in split_segments(command):
        if argv[0] == "cd" and len(argv) == 2:
            cwd = os.path.normpath(os.path.join(cwd, os.path.expanduser(argv[1])))
            continue

        env: dict[str, str] = {}
        if argv[0] == "env":
            argv = argv[1:]
        while argv and ASSIGNMENT_RE.match(argv[0]):
            name, _, value = argv[0].partition("=")
            env[name] = value
            argv = argv[1:]
        if not argv or os.path.basename(argv[0]) != "git":
            continue

        global_opts: list[str] = []
        index = 1
        while index < len(argv) and argv[index].startswith("-"):
            option = argv[index]
            if option in GLOBAL_OPTS_WITH_VALUE and index + 1 < len(argv):
                global_opts += [option, argv[index + 1]]
                index += 2
            else:
                global_opts.append(option)
                index += 1
        if index < len(argv):
            calls.append(GitCall(cwd, env, global_opts, argv[index], argv[index + 1 :]))
    return calls


def run_git(call: GitCall, *args: str) -> str | None:
    result = subprocess.run(
        ["git", "-C", call.cwd, *call.global_opts, *args],
        capture_output=True,
        text=True,
        env={**os.environ, **call.env},
        timeout=10,
        check=False,
    )
    return result.stdout.strip() if result.returncode == 0 else None


def email_of(ident: str | None) -> str | None:
    match = EMAIL_RE.search(ident or "")
    return match.group(1).strip() if match else None


def ident_email(call: GitCall, role: str) -> str | None:
    """Email git would record for `role` ("author" or "committer")."""
    ident = run_git(call, "var", f"GIT_{role.upper()}_IDENT")
    if ident:
        return email_of(ident)
    # `git var` also fails when only the name is missing; report the address.
    return (
        call.env.get(f"GIT_{role.upper()}_EMAIL")
        or run_git(call, "config", "--get", f"{role}.email")
        or run_git(call, "config", "--get", "user.email")
    )


def option_value(args: list[str], name: str) -> str | None:
    for index, arg in enumerate(args):
        if arg.startswith(f"{name}="):
            return arg.split("=", 1)[1]
        if arg == name and index + 1 < len(args):
            return args[index + 1]
    return None


def author_email(call: GitCall) -> tuple[str | None, str]:
    author = option_value(call.args, "--author")
    if author is not None:
        if "<" in author:
            return email_of(author), "--author"
        # git treats a bare --author value as a search pattern.
        found = run_git(call, "log", "-1", "--all", "-i", f"--author={author}", "--format=%ae")
        return found or None, f"--author pattern {author!r}"
    if "--amend" in call.args and "--reset-author" not in call.args:
        return run_git(call, "log", "-1", "--format=%ae", "HEAD"), "the amended commit"
    return ident_email(call, "author"), "git config"


def violations(call: GitCall, required: str) -> list[str]:
    subcommand = call.subcommand
    if subcommand not in AUTHORING_SUBCOMMANDS | COMMITTING_SUBCOMMANDS:
        return []
    if NON_WRITING_ARGS.intersection(call.args):
        return []

    found: list[tuple[str, str | None, str]] = []
    if subcommand in AUTHORING_SUBCOMMANDS:
        email, origin = author_email(call)
        found.append(("author", email, origin))
    found.append(("committer", ident_email(call, "committer"), "git config"))

    problems = []
    for role, email, origin in found:
        if (email or "").lower() != required.lower():
            shown = email if email else "no configured address"
            problems.append(
                f"`git {subcommand}` would record {role} email {shown!r} (from {origin})"
            )
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--require-email", required=True)
    parser.add_argument("--hint-name", default="")
    options = parser.parse_args()

    try:
        event = json.load(sys.stdin)
    except json.JSONDecodeError:
        return 0
    tool_input = event.get("tool_input") or {}
    command = tool_input.get("command")
    if not isinstance(command, str) or tool_input.get("is_input"):
        return 0

    cwd = event.get("working_dir") or os.environ.get("OPENHANDS_PROJECT_DIR") or os.getcwd()
    try:
        calls = find_git_calls(command, cwd)
    except ValueError:
        # Unbalanced quoting (often a heredoc). Only refuse it when it looks
        # like it commits, so the agent can resubmit the commit on its own.
        if re.search(r"\bgit\b", command) and re.search(r"\bcommit\b", command):
            problems = ["the command could not be parsed, so its commit identity is unknown"]
        else:
            return 0
    else:
        problems = [
            problem for call in calls for problem in violations(call, options.require_email)
        ]

    if not problems:
        return 0

    name = options.hint_name or "Your Name"
    reason = (
        "fork-identity-guard blocked this command: "
        + "; ".join(problems)
        + f". This fork requires {options.require_email} as author and committer. "
        + f'Re-run with `git -c user.name="{name}" -c user.email={options.require_email} ...`'
        + " (for an amend, add --reset-author), with the commit as its own command."
    )
    print(json.dumps({"decision": "deny", "reason": reason}))
    return BLOCK_EXIT_CODE


if __name__ == "__main__":
    sys.exit(main())
