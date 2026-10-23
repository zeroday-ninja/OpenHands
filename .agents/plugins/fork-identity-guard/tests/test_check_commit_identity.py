"""Tests for the fork-identity-guard PreToolUse hook.

Each case runs the real hook script against a real temporary repository whose
environment has no global or system git identity, the same as this fork's host.
The bypass regressions also run the command whenever the hook allows it, and
assert on the commit object git actually wrote, not on the hook's answer alone.
"""

import json
import subprocess
import sys
from pathlib import Path

import pytest

PLUGIN_DIR = Path(__file__).resolve().parent.parent
SCRIPT = PLUGIN_DIR / "hooks" / "check_commit_identity.py"
REQUIRED = "required@example.com"
OTHER = "other@example.com"
GOOD = f'git -c user.name="Required" -c user.email={REQUIRED}'


@pytest.fixture
def repo(tmp_path, monkeypatch):
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")
    monkeypatch.setenv("GIT_EDITOR", "true")
    monkeypatch.delenv("EMAIL", raising=False)
    for name in ("NAME", "EMAIL"):
        monkeypatch.delenv(f"GIT_AUTHOR_{name}", raising=False)
        monkeypatch.delenv(f"GIT_COMMITTER_{name}", raising=False)
    path = tmp_path / "repo"
    subprocess.run(["git", "init", "-q", str(path)], check=True)
    return path


def git(repo, *args):
    subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True)


def commit_as(repo, email):
    git(
        repo,
        "-c",
        "user.name=Someone",
        "-c",
        f"user.email={email}",
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        "seed",
    )


def run_hook(repo, command, tool_input_extra=None):
    event = {
        "event_type": "PreToolUse",
        "tool_name": "terminal",
        "tool_input": {"command": command, **(tool_input_extra or {})},
        "working_dir": str(repo),
    }
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "--require-email", REQUIRED, "--hint-name", "Required"],
        input=json.dumps(event),
        capture_output=True,
        text=True,
        cwd=repo,
        check=False,
    )
    return result


def agent_runs(repo, command):
    """Ask the hook, then run the command as the terminal would if it is allowed."""
    result = run_hook(repo, command)
    if result.returncode == 0:
        subprocess.run(["bash", "-c", command], cwd=repo, check=False, capture_output=True)
    return result


def recorded(repo, ref="HEAD"):
    """(author email, committer email, subject) of `ref`, or None if it is absent."""
    result = subprocess.run(
        ["git", "-C", str(repo), "log", "-1", "--format=%ae%n%ce%n%s", ref, "--"],
        capture_output=True,
        text=True,
        check=False,
    )
    return tuple(result.stdout.splitlines()) if result.returncode == 0 else None


def assert_blocked(result, *fragments):
    assert result.returncode == 2, result.stderr
    output = json.loads(result.stdout)
    assert output["decision"] == "deny"
    for fragment in fragments:
        assert fragment in output["reason"]


@pytest.mark.parametrize(
    "command",
    [
        "npm test && git status",
        f"{GOOD} commit -m 'feat: x; y'",
        f"cd . && {GOOD} commit -F /tmp/msg",
        "git rebase --abort",
        "git commit -m x",  # sent as input to a running process, not a command
    ],
)
def test_allows_commands_that_record_the_required_identity_or_none(repo, command):
    extra = {"is_input": True} if command == "git commit -m x" else None

    result = run_hook(repo, command, extra)

    assert result.returncode == 0, result.stdout
    assert result.stdout == ""


def test_blocks_commit_when_no_identity_is_configured(repo):
    result = run_hook(repo, "npm run lint && git commit -m x")

    assert_blocked(result, "author email", REQUIRED, 'git -c user.name="Required"')


def test_repository_config_counts_and_dash_c_overrides_it(repo):
    git(repo, "config", "user.email", OTHER)

    assert_blocked(run_hook(repo, "git commit -m x"), OTHER)
    assert run_hook(repo, f"{GOOD} commit -m x").returncode == 0


@pytest.mark.parametrize(
    ("command", "role"),
    [
        (f'{GOOD} commit --author="Someone <{OTHER}>" -m x', "author email"),
        (f"GIT_COMMITTER_EMAIL={OTHER} {GOOD} commit -m x", "committer email"),
        (f"git -c user.email={OTHER} cherry-pick HEAD", "committer email"),
    ],
)
def test_blocks_overrides_that_record_another_email(repo, command, role):
    result = run_hook(repo, command)

    assert_blocked(result, role, OTHER)


def test_amend_keeps_the_old_author_unless_reset(repo):
    commit_as(repo, OTHER)

    assert_blocked(run_hook(repo, f"{GOOD} commit --amend --no-edit"), "the amended commit")
    assert run_hook(repo, f"{GOOD} commit --amend --no-edit --reset-author").returncode == 0


@pytest.mark.parametrize(
    "options",
    [
        "-C HEAD",
        "-CHEAD",
        "-qC HEAD",
        "--reuse-message=HEAD",
        "--reuse HEAD",
        "-c HEAD",
        "--reedit-message HEAD",
        "--amend -C HEAD",
    ],
)
def test_reused_authorship_is_checked_against_the_reused_commit(repo, options):
    commit_as(repo, OTHER)

    result = agent_runs(repo, f"{GOOD} commit -q --allow-empty {options}")

    assert_blocked(result, "author email", OTHER, "the reused commit")
    assert recorded(repo) == (OTHER, OTHER, "seed")


def test_reset_author_makes_reused_authorship_the_required_identity(repo):
    commit_as(repo, OTHER)

    result = agent_runs(repo, f"{GOOD} commit -q --allow-empty -C HEAD --reset-author")

    assert result.returncode == 0, result.stdout
    assert recorded(repo) == (REQUIRED, REQUIRED, "seed")


@pytest.mark.parametrize(
    ("options", "subject"),
    [
        ("-m -C", "-C"),  # -m takes "-C" as its message
        ("-m --dry-run", "--dry-run"),
        ('--auth="Someone <other@example.com>" -m x', None),  # abbreviated --author
    ],
)
def test_option_values_and_abbreviations_are_read_as_git_reads_them(repo, options, subject):
    git(repo, "config", "user.email", OTHER)

    blocked = agent_runs(repo, f"git commit -q --allow-empty {options}")
    allowed = agent_runs(repo, f"{GOOD} commit -q --allow-empty {options}")

    assert_blocked(blocked, OTHER)
    if subject is None:
        assert_blocked(allowed, "author email", OTHER, "--author")
        assert recorded(repo) is None
    else:
        assert allowed.returncode == 0, allowed.stdout
        assert recorded(repo) == (REQUIRED, REQUIRED, subject)


@pytest.mark.parametrize(
    "action", ["stash", "stash push -q", "stash -q", "stash save wip", "stash create"]
)
def test_stash_entries_are_commits_and_are_checked(repo, action):
    (repo / "file").write_text("one\n")
    git(repo, "add", "file")
    commit_as(repo, REQUIRED)
    (repo / "file").write_text("two\n")

    blocked = agent_runs(repo, f"git -c user.name=Someone -c user.email={OTHER} {action}")
    allowed = agent_runs(repo, f"{GOOD} stash push -q")

    assert_blocked(blocked, "`git stash` would record author email", OTHER)
    assert allowed.returncode == 0, allowed.stdout
    stashes = subprocess.run(
        ["git", "-C", str(repo), "log", "-g", "--format=%ae %ce", "refs/stash", "--"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.splitlines()
    assert stashes == [f"{REQUIRED} {REQUIRED}"]


def test_stash_actions_that_write_no_commit_are_allowed(repo):
    assert run_hook(repo, "git stash list && git stash pop").returncode == 0


@pytest.mark.parametrize("operation", ["revert --no-edit HEAD", "merge --no-ff --no-edit side"])
def test_new_commits_from_revert_and_merge_check_the_author_too(repo, operation):
    (repo / "file").write_text("one\n")
    git(repo, "add", "file")
    commit_as(repo, REQUIRED)
    git(repo, "branch", "side")
    git(repo, "checkout", "-q", "side")
    (repo / "file").write_text("two\n")
    git(repo, "-c", "user.name=R", "-c", f"user.email={REQUIRED}", "commit", "-qam", "side")
    git(repo, "checkout", "-q", "-")
    if operation.startswith("revert"):
        git(repo, "-c", "user.name=R", "-c", f"user.email={REQUIRED}", "merge", "-q", "side")
    before = recorded(repo)

    blocked = agent_runs(repo, f"git -c author.email={OTHER} {GOOD[4:]} {operation}")
    assert_blocked(blocked, "author email", OTHER)
    assert recorded(repo) == before

    allowed = agent_runs(repo, f"{GOOD} {operation}")
    assert allowed.returncode == 0, allowed.stdout
    assert recorded(repo) != before
    assert recorded(repo)[:2] == (REQUIRED, REQUIRED)


def test_notes_commit_tree_and_pull_write_commits_and_are_checked(repo, tmp_path):
    commit_as(repo, REQUIRED)
    upstream = tmp_path / "upstream"
    subprocess.run(["git", "clone", "-q", str(repo), str(upstream)], check=True)
    git(
        upstream,
        "-c",
        "user.name=R",
        "-c",
        f"user.email={REQUIRED}",
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        "upstream",
    )
    commit_as(repo, REQUIRED)
    bad = f"git -c user.name=Someone -c user.email={OTHER}"
    tree_out = tmp_path / "tree-commit"
    before = recorded(repo)

    for action in (
        "notes add -m n",
        f"commit-tree HEAD^{{tree}} -m t > {tree_out}",
        f"pull -q --no-rebase --no-edit {upstream}",
    ):
        assert_blocked(agent_runs(repo, f"{bad} {action}"), OTHER)
    assert recorded(repo, "refs/notes/commits") is None
    assert not tree_out.exists()
    assert recorded(repo) == before

    for action in (
        "notes add -m n",
        f"commit-tree HEAD^{{tree}} -m t > {tree_out}",
        f"pull -q --no-rebase --no-edit {upstream}",
    ):
        assert agent_runs(repo, f"{GOOD} {action}").returncode == 0
    assert recorded(repo, "refs/notes/commits")[:2] == (REQUIRED, REQUIRED)
    assert recorded(repo, tree_out.read_text().strip()) == (REQUIRED, REQUIRED, "t")
    assert recorded(repo)[:2] == (REQUIRED, REQUIRED)
    assert recorded(repo) != before


def test_notes_actions_that_write_no_commit_are_allowed(repo):
    assert run_hook(repo, "git notes && git notes --ref review show HEAD").returncode == 0


BAD_AUTHOR = f"--author='Someone <{OTHER}>'"


@pytest.mark.parametrize(
    "command",
    [
        f"git commit -q --allow-empty -m x \\\n  {BAD_AUTHOR}",
        f"git \\\n  commit -q --allow-empty -m x {BAD_AUTHOR}",
        f"echo \\\\\ngit commit -q --allow-empty -m x {BAD_AUTHOR}",  # escaped backslash
        f"if git commit -q --allow-empty -m x {BAD_AUTHOR}; then :; fi",
        f"true && ! git commit -q --allow-empty -m x {BAD_AUTHOR}",
        f"{{ git commit -q --allow-empty -m x {BAD_AUTHOR}; }}",
        f"for i in 1; do git commit -q --allow-empty -m x {BAD_AUTHOR}; done",
        f"git --attr-source HEAD commit -q --allow-empty -m x {BAD_AUTHOR}",
        # A comment ends at the newline even after a backslash.
        f"# note \\\ngit commit -q --allow-empty -m x {BAD_AUTHOR}",
    ],
)
def test_continued_lines_reserved_words_and_global_options_are_parsed(repo, command):
    git(repo, "config", "user.name", "Required")
    git(repo, "config", "user.email", REQUIRED)
    commit_as(repo, REQUIRED)
    before = recorded(repo)

    result = agent_runs(repo, command)

    assert_blocked(result, "author email", OTHER, "--author")
    assert recorded(repo) == before


@pytest.mark.parametrize(
    "command",
    [
        f">/dev/null git commit -q --allow-empty -m x {BAD_AUTHOR}",
        f"2>/dev/null git commit -q --allow-empty -m x {BAD_AUTHOR}",
        f"</dev/null git commit -q --allow-empty -m x {BAD_AUTHOR}",
        f"git 2>&1 commit -q --allow-empty -m x {BAD_AUTHOR}",
        f"true;>/dev/null git commit -q --allow-empty -m x {BAD_AUTHOR}",
        f"true;\ngit commit -q --allow-empty -m x {BAD_AUTHOR}",
        # A substitution belongs to the redirection's target word.
        f"2>$(mktemp -d)/err git commit -q --allow-empty -m x {BAD_AUTHOR}",
        f">`mktemp -d`/out git commit -q --allow-empty -m x {BAD_AUTHOR}",
        # A quoted or substituted `{` in `${...}` does not open a brace level.
        '>${x:-"{"} git commit -q --allow-empty -m x ' + BAD_AUTHOR + "; : }",
        ">${x:-'{'} git commit -q --allow-empty -m x " + BAD_AUTHOR + "; : }",
        ">${x:-$(echo {)} git commit -q --allow-empty -m x " + BAD_AUTHOR + "; : }",
        # A `$(...)` inside `${...}` is a command too.
        ">${x:-$(git commit -q --allow-empty -m x " + BAD_AUTHOR + ")} true",
    ],
)
def test_redirections_do_not_hide_the_git_call(repo, command):
    git(repo, "config", "user.name", "Required")
    git(repo, "config", "user.email", REQUIRED)
    commit_as(repo, REQUIRED)
    before = recorded(repo)

    result = agent_runs(repo, command)

    assert_blocked(result, "author email", OTHER, "--author")
    assert recorded(repo) == before


@pytest.mark.parametrize(
    "command",
    [
        # A flag before the real option: the flag takes no value, so the
        # option after it is the option and the command writes nothing.
        "git rebase --verbose --abort",
        "git cherry-pick --quiet --abort",
        "git am --quiet --abort",
        "git commit -v --dry-run --allow-empty -m x",
    ],
)
def test_allows_non_writing_commands_after_a_flag(repo, command):
    """A guard that refuses innocent commands is a guard people switch off."""
    git(repo, "config", "user.email", OTHER)

    result = run_hook(repo, command)

    assert result.returncode == 0, result.stdout


@pytest.mark.parametrize(
    "command",
    [
        "cat > s.sh <<'EOF'\nif git commit -q --allow-empty -m x; then :; fi\nEOF",
        "cat > s.sh <<EOF\ngit add -A \\\n  && git commit -q --allow-empty -m x\nEOF",
        "'if' git commit -q --allow-empty -m x > s.sh",  # runs a command named `if`
        # Substitutions, ANSI-C quotes and arrays stay inside one word.
        "echo $(date) git commit -q --allow-empty -m x > s.sh",
        'echo "$(echo "it\'s") git commit -q --allow-empty -m x" > s.sh',
        "printf $'it\\'s git commit -q --allow-empty -m x\\n' > s.sh",
        'cmd=(git commit -q --allow-empty -m x) && echo "${cmd[@]}" > s.sh',
        # A quoted `}` or `{` in `${...}` is data and does not end or nest it.
        'printf "%s\\n" "${close:-"}"}" "git commit -q --allow-empty -m x" > s.sh',
        "echo ${open:-'{'} \"it's git commit -q --allow-empty -m x\" > s.sh",
    ],
)
def test_commands_that_do_not_run_git_are_allowed(repo, command):
    git(repo, "config", "user.email", OTHER)

    result = agent_runs(repo, command)

    assert result.returncode == 0, result.stdout
    assert (repo / "s.sh").exists()
    assert recorded(repo) is None


@pytest.mark.parametrize(
    ("earlier_segment", "leaked"),
    [
        (f"git config user.email {OTHER} && git commit", (OTHER, OTHER)),
        # Pinning the identity on the commit does not beat a variable or
        # author.email set by an earlier segment, which outrank user.email.
        (f"export GIT_AUTHOR_EMAIL={OTHER} && {GOOD} commit", (OTHER, REQUIRED)),
        (f"git config author.email {OTHER} && {GOOD} commit", (OTHER, REQUIRED)),
    ],
)
def test_known_limit_an_earlier_segment_can_change_the_identity_unseen(
    repo, earlier_segment, leaked
):
    """The hook runs before the command, so it judges the state from before it.

    This test pins the documented limit: if it starts failing, the hook has
    learned something new and the README's Limits section must change with it.
    """
    git(repo, "config", "user.name", "Required")
    git(repo, "config", "user.email", REQUIRED)

    result = agent_runs(repo, f"{earlier_segment} -q --allow-empty -m leaked")

    assert result.returncode == 0, result.stdout
    assert recorded(repo) == (*leaked, "leaked")


def test_plugin_hook_blocks_through_the_sdk(repo):
    """Load the plugin the way a conversation does and fire its PreToolUse hook."""
    pytest.importorskip("openhands.sdk")
    from openhands.sdk.hooks import HookManager
    from openhands.sdk.plugin import Plugin

    plugin_copy = repo / ".agents" / "plugins" / "fork-identity-guard"
    plugin_copy.parent.mkdir(parents=True)
    subprocess.run(["cp", "-r", str(PLUGIN_DIR), str(plugin_copy)], check=True)
    plugin = Plugin.load(plugin_copy)
    manager = HookManager(config=plugin.hooks, working_dir=str(repo))

    allowed, results = manager.run_pre_tool_use("terminal", {"command": "git commit -m x"})

    assert plugin.name == "fork-identity-guard"
    assert not allowed
    assert "tentpegbob@gmail.com" in manager.get_blocking_reason(results)
    allowed, _ = manager.run_pre_tool_use("terminal", {"command": "git status"})
    assert allowed
