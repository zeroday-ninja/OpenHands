# Agent Canvas docs

This directory contains the project documentation.

- [Architecture](./architecture.md): system boundaries, runtime modes, and quality gates.
- [Using ACP agents](./ACP_AGENTS.md): onboard and configure external agents (Claude Code, Codex, Gemini CLI, Pi, OpenCode).
- [Docker sandboxes: networking and access](./DOCKER_SANDBOXES.md): how the browser and per-conversation sandboxes reach Canvas (`OH_CONVERSATION_RUNTIME=docker`), including the API-only sandbox ingress on the Docker bridge.
- [Local models with LM Studio](./LOCAL_MODELS.md): run the OpenHands agent on an LM Studio model, including in Docker sandboxes. Covers the gpt-oss `tool_choice` shim.
- [Development guide](./DEVELOPMENT.md)
- [Canvas Extensions manual testing](./CANVAS_EXTENSIONS_TESTING.md)
- [Self-hosting guide](./SELF_HOSTING.md)
- [Integrating DefenseClaw](./DefenseClaw.md): run the DefenseClaw security governance layer alongside the Agent Server.
- [Testing matrix](./TESTING_MATRIX.md): release smoke-test coverage across installers, operating systems, and agents.
- [Feature verification map](../.agents/skills/verify-openhands/references/feature-map/README.md): every user-facing feature with entry points and rerunnable `control-openhands` recipes; start with the [verify-openhands skill](../.agents/skills/verify-openhands/SKILL.md) to launch and drive the real app.
