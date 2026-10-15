# Local models with LM Studio

This guide runs the built-in **OpenHands** agent against a model served by
[LM Studio](https://lmstudio.ai/)'s OpenAI-compatible server. It covers the
per-conversation Docker sandboxes from the README's
[Option 3](../README.md#option-3-with-multiple-docker-sandboxes)
(`OH_CONVERSATION_RUNTIME=docker`), where the agent's LLM calls come from inside
a container rather than from the host. To turn sandboxes on for `npm run dev`,
uncomment the "Per-conversation Docker sandboxes" block in your `.env`, which
starts as a copy of [`.env.sample`](../.env.sample).

Verified on 2026-10-15 on Linux (Docker Engine 29) with:
- agent-server 1.55.0;
- LM Studio llama.cpp runtimes 2.23.1, 2.49.0 and 2.58.1;
- the model `openai/gpt-oss-20b`.

> [!IMPORTANT]
> With gpt-oss, LM Studio rejects OpenHands' tool-calling requests (see
> [gpt-oss tool calls fail](#gpt-oss-tool-calls-fail-with-peg-native-format)).
> The fix is a small proxy, [`examples/lmstudio-shim/`](../examples/lmstudio-shim/),
> that forces every tool-bearing request to answer with a tool call.
> **If local-model conversations break, check that this shim is running first.**

## 1. Prepare LM Studio

1. Load the model with a large context. OpenHands' first request alone is about
   75 KB of system prompt and tool schemas. Use `--parallel` so several sandboxes
   can run at once:

   ```sh
   lms load openai/gpt-oss-20b --gpu max -c 131072 --parallel 4 -y
   ```

2. Check that LM Studio itself works:

   ```sh
   curl http://localhost:1234/api/v1/chat \
     -H "Content-Type: application/json" \
     -d '{
       "model": "openai/gpt-oss-20b",
       "system_prompt": "You answer only in rhymes.",
       "input": "What is your favorite color?"
   }'
   ```

### NVIDIA Blackwell GPUs need the CUDA 12 runtime

LM Studio's `llama.cpp-…-nvidia-cuda-avx2` runtime links against CUDA 11
(`libcudart.so.11.0`) and ships no `sm_120` kernels. On Blackwell cards such as
the RTX 50-series or RTX PRO 6000 it loads the model, then crashes during
generation:
- the API returns `{"error":{"message":"terminated","type":"internal_error",…}}`;
- the server log shows `Channel Error … Caused By: TypeError: terminated` right
  after prompt processing.

Select the CUDA 12 build and reload the model:

```sh
lms runtime ls                       # the ✓ marks the selected runtime
lms runtime select llama.cpp-linux-x86_64-nvidia-cuda12-avx2@<version>
lms unload --all && lms load openai/gpt-oss-20b --gpu max -c 131072 --parallel 4 -y
```

## 2. Add the LLM profile

In **Settings → LLM**, create a profile in the **Advanced** view. The Basic view
resets the base URL.

| Field          | Value                                                              |
| -------------- | ------------------------------------------------------------------ |
| Custom model   | `lm_studio/openai/gpt-oss-20b` (`lm_studio/` + the LM Studio id)   |
| Base URL       | `http://172.17.0.1:1235/v1` (the shim; see below)                  |
| API key        | any non-empty string, e.g. `lm-studio`                             |

Leave native tool calling on (the default). Then add an OpenHands agent profile
that uses this LLM profile under **Settings → Agents**.

Why these values:

- **Model prefix.** Use `lm_studio/<id>`, not `openai/openai/gpt-oss-20b`. With
  the double `openai/` prefix, LiteLLM strips both segments and requests
  `gpt-oss-20b`. LM Studio then just-in-time loads a *second* copy of the model
  under that name, and `lms ps` shows two instances.
- **Base URL host.** The URL must work from two places:
  - The host agent-server calls it to validate the profile when you save.
  - The sandbox containers call it during conversations.

  `localhost` inside a sandbox is the container itself.
  `host.docker.internal` resolves inside sandboxes (they start with
  `--add-host host.docker.internal:host-gateway`) but usually not on a Linux
  host, so validation on save fails. The Docker bridge gateway works from both.
  It is `172.17.0.1` by default; check with `ip -4 addr show docker0`.

The same profile can be created over the API with the session key from
`~/.openhands/agent-canvas/api-key.txt`:

```sh
KEY=$(cat ~/.openhands/agent-canvas/api-key.txt); B=http://127.0.0.1:18000
LLM='{"model":"lm_studio/openai/gpt-oss-20b","base_url":"http://172.17.0.1:1235/v1","api_key":"lm-studio"}'
curl -s -X POST $B/api/profiles/lm-studio/validate -H "X-Session-API-Key: $KEY" -H 'Content-Type: application/json' -d "{\"llm\":$LLM}"
curl -s -X POST $B/api/profiles/lm-studio -H "X-Session-API-Key: $KEY" -H 'Content-Type: application/json' -d "{\"llm\":$LLM,\"include_secrets\":true}"
curl -s -X POST $B/api/agent-profiles/lm-studio -H "X-Session-API-Key: $KEY" -H 'Content-Type: application/json' -d '{"agent_kind":"openhands","llm_profile_ref":"lm-studio"}'
```

## gpt-oss tool calls fail with "peg-native format"

**Symptom.** Every conversation errors on its first LLM call. The SDK retries
five times, then the conversation stops with:

```
LLMServiceUnavailableError … Engine protocol predict stream returned an error:
{"code":500,"message":"The model produced output that does not match the expected peg-native format"}
```

Plain chat, such as the curl test above, still works because it sends no tools.

**Investigation.** These results come from replaying a captured OpenHands request
(21 tools, about 75 KB) directly against LM Studio:

| Change                                                                     | Result                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| None, streamed or not                                                      | Always fails                                                                                                                                                                                                                     |
| No tools                                                                   | Works                                                                                                                                                                                                                            |
| One tool removed at a time                                                 | Only removing `finish` avoids it reliably                                                                                                                                                                                        |
| `reasoning_effort` low/medium/high, `temperature: 0`, `parallel_tool_calls: false` | Always fails                                                                                                                                                                                                             |
| LM Studio runtime 2.23.1 / 2.49.0 / 2.58.1 (CUDA 12)                       | Fails intermittently / always / always                                                                                                                                                                                           |
| `native_tool_calling: false` (prompt-based tools)                          | No error, but the agent gets **stuck**. gpt-oss still emits its native tool-call syntax. With no tools declared, LM Studio drops it and returns empty `content` and `tool_calls`. OpenHands keeps replying "Your last response did not include a function call or a message" until stuck detection ends the conversation. |
| `tool_choice: "required"`                                                  | Always works (the model calls `finish`)                                                                                                                                                                                          |

**Why `required` works.** With `required`, LM Studio constrains decoding to a
valid tool call, so its parser never sees the free-form output it rejects.
This matches how OpenHands works: the agent acts only through tools, and its
final reply goes through `finish`.

**Why not put it in the LLM profile.** You could set `litellm_extra_body` to
`{"tool_choice":"required"}`, but that breaks other calls. LM Studio rejects
`required` when a request has no tools ("Tool choice 'required' must be specified
with 'tools' parameter"), and the same LLM also makes tool-less calls:
conversation titles and history summarization by the condenser.

### The shim

[`examples/lmstudio-shim/shim.py`](../examples/lmstudio-shim/shim.py) is a
dependency-free Python reverse proxy. By default it listens on `172.17.0.1:1235`
and forwards to LM Studio on `127.0.0.1:1234`.
- It adds `tool_choice: "required"` to `/chat/completions` requests that carry
  tools and have no `tool_choice`, or have `"auto"`.
- Every other request is forwarded unchanged, and streaming responses pass
  through as they arrive.

Because the shim binds the Docker bridge address:
- the host and the sandboxes can reach it, but other machines on your network can't;
- LM Studio itself can stay on loopback.

Install it as a systemd user service:

```sh
mkdir -p ~/.local/share/openhands-lmstudio-shim ~/.config/systemd/user
cp examples/lmstudio-shim/shim.py ~/.local/share/openhands-lmstudio-shim/
cp examples/lmstudio-shim/openhands-lmstudio-shim.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now openhands-lmstudio-shim.service
```

Notes on the service:
- The bridge address exists only while Docker is running, so the unit uses
  `Restart=always` and keeps retrying until it can bind.
- User services start at login. For a headless machine, run
  `loginctl enable-linger "$USER"`.
- To use a different address, port, or upstream, set `SHIM_LISTEN_HOST`,
  `SHIM_LISTEN_PORT`, or `SHIM_UPSTREAM` with `Environment=` lines in the unit.

Verify it. The response should contain a `finish` tool call:

```sh
systemctl --user is-active openhands-lmstudio-shim.service
curl -s http://172.17.0.1:1235/v1/chat/completions -H 'Content-Type: application/json' -d '{
  "model": "openai/gpt-oss-20b",
  "messages": [{"role": "user", "content": "Say hi to the user."}],
  "tools": [{"type": "function", "function": {"name": "finish", "description": "Send the final message to the user.",
    "parameters": {"type": "object", "properties": {"message": {"type": "string"}}, "required": ["message"]}}}]
}'
```

Trade-off: the model can no longer answer in plain text, so every reply arrives
as a `finish` action's message. Only gpt-oss-20b has been tested. Other
tool-capable models may not need the shim, but forcing tool calls through it is
harmless for OpenHands.

To remove the shim:
1. Run `systemctl --user disable --now openhands-lmstudio-shim.service`.
2. Delete the unit file and `~/.local/share/openhands-lmstudio-shim/`.
3. Point the profile at `http://172.17.0.1:1234/v1`. LM Studio must then serve on
   the local network so containers can reach it.

## Troubleshooting

1. **Is LM Studio healthy?** Run the curl test in [step 1](#1-prepare-lm-studio).
   If you get `terminated`, see the CUDA 12 section above.
2. **Is the shim up?** Run
   `systemctl --user status openhands-lmstudio-shim.service` and
   `ss -ltn | grep 1235`.
3. **What does LM Studio's log say?** Look in
   `~/.lmstudio/server-logs/<YYYY-MM>/<date>.log`.
   - `peg-native` means a request reached LM Studio without the shim. Check the
     profile's base URL port.
   - `Channel Error` means the wrong CUDA runtime is selected.
4. **Is the model loaded twice?** If `lms ps` shows two instances, the model
   prefix is wrong; see [step 2](#2-add-the-llm-profile).
5. **Can a sandbox reach the shim?** This should print `200`:

   ```sh
   docker run --rm --entrypoint python3 ghcr.io/openhands/agent-server:<version>-python \
     -c "import urllib.request; print(urllib.request.urlopen('http://172.17.0.1:1235/v1/models').status)"
   ```

6. **Has LM Studio fixed the parser?** Replay a tool-bearing OpenHands request
   directly against port `1234`. If it succeeds without `tool_choice`, you can
   remove the shim.

## Claude Code and Codex in the same sandboxes

The ACP agents don't use LM Studio, but they hit a related trap in this mode.
Your host logins (`~/.claude`, `~/.codex`) are **not** mounted into sandboxes.
Onboarding's sign-in check runs its status command through the agent-server's
bash endpoint, which executes on the host. It can therefore report
"already signed in" while every sandbox has no credentials. Save them explicitly
under **Settings → Secrets**:

- `CLAUDE_CODE_OAUTH_TOKEN`: the long-lived token printed by `claude setup-token`.
- `CODEX_AUTH_JSON`: the full contents of `~/.codex/auth.json`.

See [Using ACP agents](./ACP_AGENTS.md#how-credentials-reach-a-containerized-agent)
for how these secrets reach the agent.
