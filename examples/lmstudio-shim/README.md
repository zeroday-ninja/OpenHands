# LM Studio tool_choice shim

This is a dependency-free Python reverse proxy that lets the OpenHands agent use
gpt-oss through LM Studio. LM Studio rejects gpt-oss's output for OpenHands'
tool-bearing requests with `The model produced output that does not match the
expected peg-native format`.

The shim adds `tool_choice: "required"` only to `/chat/completions` requests
that carry tools. Everything else is forwarded unchanged.

- `shim.py`: the proxy. It listens on `172.17.0.1:1235` (the Docker bridge) and
  forwards to `127.0.0.1:1234`. Override these with `SHIM_LISTEN_HOST`,
  `SHIM_LISTEN_PORT`, and `SHIM_UPSTREAM`.
- `openhands-lmstudio-shim.service`: a systemd user unit that runs it from
  `~/.local/share/openhands-lmstudio-shim/`.

For the investigation, install steps, LLM profile values, and troubleshooting,
see [`docs/LOCAL_MODELS.md`](../../docs/LOCAL_MODELS.md).
