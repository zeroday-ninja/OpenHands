"""Tests for the fork-identity-guard PreToolUse hook.

Each case runs the real hook script against a real temporary repository whose
environment has no global or system git identity, the same as this fork's host.
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
