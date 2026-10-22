#!/usr/bin/env python3
"""PreToolUse hook: refuse a git command that would record the wrong email.

The OpenHands hook executor sends the pending tool call as JSON on stdin and
treats exit code 2 as "block". This script finds every git invocation in a
terminal command that writes a commit object, asks git itself which author and
committer identity that invocation would record (honouring `-c user.email=`,
`-C`, `VAR=value` prefixes, repository config, `--author`, `--amend` and the
authorship-reusing `-C`/`-c` commit options), and blocks the call when either
email differs from the one this fork requires.

It judges every call against the state that exists before the command runs. It
cannot know what an earlier segment of the same command (`git config ... &&`,
`export ... &&`) will change, so it is a best-effort check, not a guarantee.

Anything it cannot recognise as a commit-writing git call is allowed: the hook
must never stand between the agent and unrelated commands.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass, field

BLOCK_EXIT_CODE = 2

# Subcommands that write a commit object whose author and committer both come
# from the current identity.
AUTHORING_SUBCOMMANDS = {"commit", "commit-tree", "merge", "pull", "revert", "stash", "notes"}
# Subcommands that replay commits: each keeps its original author and only the
# committer comes from the current identity.
COMMITTING_SUBCOMMANDS = {"cherry-pick", "rebase", "am"}

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

# `git stash` and `git notes` actions that write a commit. A bare `git stash`,
# or one that starts with an option, is `git stash push`.
STASH_WRITING_ACTIONS = {"push", "save", "create"}
NOTES_WRITING_ACTIONS = {"add", "copy", "append", "edit", "merge", "remove", "prune"}

# `git commit` options, as listed by `git commit -h` (git 2.47). git accepts
# any unambiguous prefix of a long option and clusters short ones (`-aC HEAD`),
# so the hook resolves them the same way rather than matching literal strings.
COMMIT_SHORT = {
    "q": "quiet",
    "v": "verbose",
    "F": "file",
    "m": "message",
    "c": "reedit-message",
    "C": "reuse-message",
    "s": "signoff",
    "t": "template",
    "e": "edit",
    "S": "gpg-sign",
    "a": "all",
    "i": "include",
    "p": "patch",
    "o": "only",
    "n": "no-verify",
    "z": "null",
    "u": "untracked-files",
}
COMMIT_LONG_WITH_VALUE = {
    "file",
    "author",
    "date",
    "message",
    "reedit-message",
    "reuse-message",
    "fixup",
    "squash",
    "trailer",
    "template",
    "cleanup",
    "pathspec-from-file",
}
COMMIT_LONG_OPTIONAL_VALUE = {"gpg-sign", "untracked-files"}
COMMIT_LONG_FLAGS = {
    "quiet",
    "verbose",
    "reset-author",
    "signoff",
    "edit",
    "status",
    "all",
    "include",
    "interactive",
    "patch",
    "only",
    "dry-run",
    "short",
    "branch",
    "ahead-behind",
    "porcelain",
    "long",
    "null",
    "amend",
    "pathspec-file-nul",
}
COMMIT_LONG_NAMES = (
    {
        f"{prefix}{name}"
        for name in COMMIT_LONG_WITH_VALUE | COMMIT_LONG_OPTIONAL_VALUE | COMMIT_LONG_FLAGS
        for prefix in ("", "no-")
    }
    | {"no-verify", "verify", "no-post-rewrite", "post-rewrite"}
) - {"no-trailer"}

# git global options that take a separate value (`git -C dir commit`).
GLOBAL_OPTS_WITH_VALUE = {
    "-c",
    "-C",
    "--git-dir",
    "--work-tree",
    "--namespace",
    "--exec-path",
    "--config-env",
    "--attr-source",
}

# Shell operators, longest first so `&&` is not read as two `&`.
CONTROL_OPERATORS = ["&&", "||", ";;&", ";;", ";&", "|&", ";", "|", "&", "(", ")", "\n"]
REDIRECT_OPERATORS = ["&>>", "<<<", "<<-", "<<", ">>", "<&", ">&", "<>", ">|", "&>", "<", ">"]
OPERATORS = sorted(CONTROL_OPERATORS + REDIRECT_OPERATORS, key=len, reverse=True)
OPERATOR_CHARS = set("&|;()<>\n")
# Reserved words that can stand before a command (`if git commit ...; then`).
# Quoted, they are ordinary words (`'if' git ...` runs a command named `if`).
RESERVED_WORDS = {"!", "{", "if", "then", "elif", "else", "while", "until", "do"}
# The fd in `2>file`, or bash's `{fd}>file`, when written right before `<`/`>`.
IO_NUMBER_RE = re.compile(r"^(?:[0-9]+|\{[A-Za-z_][A-Za-z0-9_]*\})$")
ASSIGNMENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")
EMAIL_RE = re.compile(r"<([^<>]*)>")


@dataclass
class GitCall:
    cwd: str
    env: dict[str, str]
    global_opts: list[str]
    subcommand: str
    args: list[str] = field(default_factory=list)


@dataclass
class Token:
    text: str
    operator: bool = False
    quoted: bool = False


def tokenize(command: str) -> list[Token]:
    """Split a command into words and operators the way POSIX sh does.

    It follows the token rules closely enough to place every word: quotes, a
    backslash-newline continuation (not inside single quotes or a comment),
    `#` comments, redirections with their fd numbers, and here-document
    bodies, which are data and are skipped. It does not expand anything.
    Raises ValueError on an unterminated quote.
    """
    tokens: list[Token] = []
    heredocs: list[tuple[str, bool]] = []
    index, end = 0, len(command)
    while index < end:
        char = command[index]
        if command.startswith("\\\n", index):
            index += 2
        elif char in " \t\r":
            index += 1
        elif char == "#":
            while index < end and command[index] != "\n":
                index += 1
        elif char in OPERATOR_CHARS:
            operator = next(op for op in OPERATORS if command.startswith(op, index))
            index += len(operator)
            tokens.append(Token(operator, operator=True))
            if operator == "\n" and heredocs:
                index = skip_heredoc_bodies(command, index, heredocs)
                heredocs = []
        else:
            index, word = read_word(command, index)
            before_redirect = index < end and command[index] in "<>"
            if before_redirect and not word.quoted and IO_NUMBER_RE.match(word.text):
                continue
            tokens.append(word)
            if len(tokens) > 1 and tokens[-2].operator and tokens[-2].text in {"<<", "<<-"}:
                heredocs.append((word.text, tokens[-2].text == "<<-"))
    return tokens


def read_word(command: str, index: int) -> tuple[int, Token]:
    word = Token("")
    end = len(command)
    while index < end:
        char = command[index]
        if command.startswith("\\\n", index):
            index += 2
        elif char == "\\" and index + 1 < end:
            word.text += command[index + 1]
            word.quoted = True
            index += 2
        elif char == "'":
            close = command.find("'", index + 1)
            if close < 0:
                raise ValueError("unterminated single quote")
            word.text += command[index + 1 : close]
            word.quoted = True
            index = close + 1
        elif char == '"':
            index += 1
            while index < end and command[index] != '"':
                if command[index] == "\\" and index + 1 < end and command[index + 1] in '$`"\\\n':
                    if command[index + 1] != "\n":
                        word.text += command[index + 1]
                    index += 2
                else:
                    word.text += command[index]
                    index += 1
            if index >= end:
                raise ValueError("unterminated double quote")
            word.quoted = True
            index += 1
        elif char in " \t\r" or char in OPERATOR_CHARS:
            break
        else:
            word.text += char
            index += 1
    return index, word


def skip_heredoc_bodies(command: str, index: int, heredocs: list[tuple[str, bool]]) -> int:
    """Index just past the here-document bodies that start at `index`."""
    for delimiter, strip_tabs in heredocs:
        while index < len(command):
            newline = command.find("\n", index)
            line_end = len(command) if newline < 0 else newline
            line = command[index:line_end]
            index = line_end + 1
            if (line.lstrip("\t") if strip_tabs else line) == delimiter:
                break
    return min(index, len(command))


def split_segments(command: str) -> list[list[str]]:
    """Split a shell command into simple commands, without their redirections.

    Each segment starts at its command name: leading unquoted reserved words
    (`if`, `!`, `{` ...) are dropped.
    """
    segments: list[list[Token]] = [[]]
    redirecting = False
    for token in tokenize(command):
        if token.operator and token.text in CONTROL_OPERATORS:
            segments.append([])
            redirecting = False
        elif token.operator:
            redirecting = True
        elif redirecting:
            # A redirection's target is not part of the command's argv.
            redirecting = False
        else:
            segments[-1].append(token)
    argvs = []
    for segment in segments:
        while segment and not segment[0].quoted and segment[0].text in RESERVED_WORDS:
            segment = segment[1:]
        if segment:
            argvs.append([token.text for token in segment])
    return argvs


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


def resolve_long(name: str) -> str | None:
    """Full `git commit` long option for `name`, which may be abbreviated."""
    if name in COMMIT_LONG_NAMES:
        return name
    matches = [option for option in COMMIT_LONG_NAMES if option.startswith(name)]
    # git rejects an ambiguous prefix, so the command would not commit.
    return matches[0] if len(matches) == 1 else None


@dataclass
class CommitOptions:
    author: str | None = None
    reuse: str | None = None
    amend: bool = False
    reset_author: bool = False


def parse_commit_args(args: list[str]) -> CommitOptions:
    """The `git commit` options that decide which author is recorded."""
    options = CommitOptions()
    settings: list[tuple[str, str | None]] = []
    index = 0
    while index < len(args):
        arg = args[index]
        index += 1
        if arg == "--":
            break
        if arg.startswith("--"):
            name, has_value, value = arg[2:].partition("=")
            option = resolve_long(name)
            if option in COMMIT_LONG_WITH_VALUE and not has_value:
                value = args[index] if index < len(args) else ""
                index += 1
            if option:
                settings.append((option, value))
        elif arg.startswith("-") and len(arg) > 1:
            cluster = arg[1:]
            for position, letter in enumerate(cluster):
                option = COMMIT_SHORT.get(letter)
                rest = cluster[position + 1 :]
                if option in COMMIT_LONG_WITH_VALUE:
                    if not rest:
                        rest = args[index] if index < len(args) else ""
                        index += 1
                    settings.append((option, rest))
                    break
                if option in COMMIT_LONG_OPTIONAL_VALUE:
                    break
                if option:
                    settings.append((option, None))

    for option, value in settings:
        if option == "author":
            options.author = value
        elif option == "no-author":
            options.author = None
        elif option in {"reuse-message", "reedit-message"}:
            options.reuse = value
        elif option in {"no-reuse-message", "no-reedit-message"}:
            options.reuse = None
        elif option in {"amend", "no-amend"}:
            options.amend = option == "amend"
        elif option in {"reset-author", "no-reset-author"}:
            options.reset_author = option == "reset-author"
    return options


def commit_author(call: GitCall, revision: str) -> str | None:
    return run_git(call, "log", "-1", "--format=%ae", "--end-of-options", revision, "--")


def author_email(call: GitCall) -> tuple[str | None, str]:
    """Email `git commit` would record as author, in git's own precedence."""
    options = parse_commit_args(call.args)
    author = options.author
    if author is not None:
        if "<" in author:
            return email_of(author), "--author"
        # git treats a bare --author value as a search pattern.
        found = run_git(call, "log", "-1", "--all", "-i", f"--author={author}", "--format=%ae")
        return found or None, f"--author pattern {author!r}"
    if options.reset_author:
        return ident_email(call, "author"), "git config"
    # -C/-c reuse the named commit's authorship, and so does --amend for HEAD.
    if options.reuse is not None:
        return commit_author(call, options.reuse), f"the reused commit {options.reuse!r}"
    if options.amend:
        return commit_author(call, "HEAD"), "the amended commit"
    return ident_email(call, "author"), "git config"


def first_action(args: list[str], options_with_value: set[str]) -> str | None:
    index = 0
    while index < len(args):
        arg = args[index]
        if arg in options_with_value:
            index += 2
        elif arg.startswith("-"):
            index += 1
        else:
            return arg
    return None


def has_non_writing_arg(args: list[str]) -> bool:
    """True when an argument such as `--abort` really is an option.

    `git commit -m --dry-run` commits with the message "--dry-run", so an
    argument right after a bare option may be that option's value. Such a
    command is checked rather than waved through.
    """
    previous = None
    for arg in args:
        if arg == "--":
            return False
        value_slot = previous is not None and previous.startswith("-") and "=" not in previous
        if arg in NON_WRITING_ARGS and not value_slot:
            return True
        previous = arg
    return False


def writes_commit(call: GitCall) -> bool:
    if call.subcommand not in AUTHORING_SUBCOMMANDS | COMMITTING_SUBCOMMANDS:
        return False
    if has_non_writing_arg(call.args):
        return False
    if call.subcommand == "stash":
        if not call.args or call.args[0].startswith("-"):
            return True
        return call.args[0] in STASH_WRITING_ACTIONS
    if call.subcommand == "notes":
        return first_action(call.args, {"--ref"}) in NOTES_WRITING_ACTIONS
    return True


def violations(call: GitCall, required: str) -> list[str]:
    subcommand = call.subcommand
    if not writes_commit(call):
        return []

    found: list[tuple[str, str | None, str]] = []
    if subcommand == "commit":
        email, origin = author_email(call)
        found.append(("author", email, origin))
    elif subcommand in AUTHORING_SUBCOMMANDS:
        found.append(("author", ident_email(call, "author"), "git config"))
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
