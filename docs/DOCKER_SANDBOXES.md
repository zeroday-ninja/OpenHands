# Docker sandboxes: networking and access

With `OH_CONVERSATION_RUNTIME=docker` (README
[Option 3](../README.md#option-3-with-multiple-docker-sandboxes)), each
conversation runs in its own agent-server container. Canvas, the outer
agent-server, and the automation service stay on the host. This page explains
how your browser and the sandboxes each reach those host services, and why the
two paths differ.

## Linux with Docker Engine

The launcher (`npm run dev`, `npm run dev:static`, or the `agent-canvas` binary)
starts two ingress listeners:

| Listener        | Address                    | Serves                                                 | Used by                                   |
| --------------- | -------------------------- | ------------------------------------------------------ | ----------------------------------------- |
| Ingress         | `127.0.0.1:8000`           | The UI and every API, with the session key injected    | The browser on this machine               |
| Sandbox ingress | Docker bridge gateway:8000 | Only `/api/automation/*`, `/api/*`, and `/server_info` | Sandboxes, as `host.docker.internal:8000` |

The agent-server (`:18000`), automation (`:18001`), and frontend (`:3001`) stay
on loopback behind them. The bridge gateway is `172.17.0.1` by default. The SDK
starts every sandbox with `--add-host host.docker.internal:host-gateway`, and
Docker resolves `host-gateway` to that address. The launcher reads it from
`docker network inspect bridge` and uses it only if it is assigned to an
interface on this host.

What this gives you:

- **The page connects by itself.** The browser-facing listeners are on
  loopback, so the launcher injects the session key. There is no "Add a
  backend" or API-key screen, and nothing is reachable from your LAN.
- **Sandboxes keep their access to Canvas's services.** The `<RUNTIME_SERVICES>`
  block tells agents that automation is at `http://host.docker.internal:8000`
  under `/api/automation`. Agents authenticate with
  `X-Session-API-Key: $OPENHANDS_AUTOMATION_API_KEY`; the launcher saves that
  secret, and Canvas passes it to every conversation.
- **The frontend is not served on the bridge.** On a loopback bind the frontend
  carries the injected session key, and _any_ container on the bridge network
  can connect to the sandbox ingress, not just sandboxes. With API-only routes,
  a container still needs the key to use the API, and only sandboxes are given
  it. Every other path answers `503`. The `<RUNTIME_SERVICES>` block therefore
  leaves out the frontend and describes the ingress as API-only.

The launcher banner shows the extra listener:

```
║  Sandbox API:  http://172.17.0.1:8000/api
```

## Docker Desktop (macOS, or WSL 2 with Docker Desktop integration)

Docker Desktop keeps the bridge inside its own VM, so nothing on the host can
bind the gateway address. The launcher detects this and keeps the earlier
behavior:

- It listens on every interface (`0.0.0.0`) so sandboxes can reach it.
- It does **not** inject the session key, so the UI asks for the API key once.
  Paste the contents of `~/.openhands/agent-canvas/api-key.txt`.
- It logs:
  `The Docker bridge gateway is not a local address (Docker Desktop?); binding 0.0.0.0…`.

Docker Engine installed directly inside a WSL 2 distribution behaves like Linux.

## Settings

| Setting                   | Effect                                                                                                                                                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--host` / `OH_BIND_HOST` | Explicit browser-facing bind. A loopback address still gets the sandbox ingress. Any other address (for example `0.0.0.0`) already covers the bridge, so no second listener starts, and the key is not injected.                 |
| `OH_SANDBOX_BRIDGE_HOST`  | Bind the sandbox ingress to this address instead of the detected gateway. Use it when the Docker daemon sets a custom `host-gateway-ip`. It also enables loopback-plus-bridge where detection fails but the address is bindable. |

To enable sandboxes for `npm run dev`, uncomment the "Per-conversation Docker
sandboxes" block in your `.env`, which starts as a copy of
[`.env.sample`](../.env.sample).

## Using Canvas from another computer

The browser-facing listeners are loopback-only, so reach them through a tunnel
that ends on this machine. The page then arrives with the key injected, exactly
as it does locally:

```sh
ssh -N -L 8000:127.0.0.1:8000 <user>@<canvas-host>   # then open http://localhost:8000
```

Editor port forwarding, such as VS Code Remote, works the same way. Avoid
`OH_BIND_HOST=0.0.0.0` unless you accept LAN exposure; the UI then asks for the
API key.

## Verify

```sh
ss -ltn | grep ':8000 '   # 127.0.0.1:8000 and 172.17.0.1:8000; nothing on 0.0.0.0
KEY=$(cat ~/.openhands/agent-canvas/api-key.txt)
curl -s -o /dev/null -w '%{http_code}\n' http://172.17.0.1:8000/   # 503: no frontend on the bridge
curl -s -o /dev/null -w '%{http_code}\n' -H "X-Session-API-Key: $KEY" \
  'http://172.17.0.1:8000/api/automation/v1/drafts?limit=1'          # 200
```

From inside a conversation, an agent's terminal should get `200` from:

```sh
curl -s -o /dev/null -w '%{http_code}\n' -H "X-Session-API-Key: $OPENHANDS_AUTOMATION_API_KEY" \
  'http://host.docker.internal:8000/api/automation/v1/drafts?limit=1'
```

## Troubleshooting

- **The UI still asks for a backend or API key.** Check each of these:
  - Is your browser on another machine? Use a tunnel.
  - Did you set `OH_BIND_HOST` to a non-loopback address?
  - Did the launcher log the Docker Desktop fallback?
- **Sandboxes cannot reach `host.docker.internal:8000`.**
  - Check that the banner shows `Sandbox API` and that `ss -ltn` lists the
    bridge listener.
  - A host firewall may drop traffic arriving from `docker0`. With ufw, allow it:
    `sudo ufw allow in on docker0 to any port 8000 proto tcp`.
- **`Cannot start: … sandbox ingress on 172.17.0.1: port 8000`.** Another
  process holds the port on the bridge address, such as a manually run
  forwarder or another stack. Stop it, or change the port with `PORT`.
- **Local models in sandboxes:** see [Local models with LM Studio](./LOCAL_MODELS.md).
  LLM calls go straight to the model server and do not use the sandbox ingress.
- **Codex: `ChatGPT authentication did not complete in time`.** The stored
  `CODEX_AUTH_JSON` login no longer works. `codex login status` doesn't detect
  this, because it only checks that the file exists.
  - **Why it happens:** Codex refreshes the login in each sandbox, and every
    refresh replaces the refresh token. The Agent Server stores the refreshed
    login again before it starts a sandbox, after model discovery, and before
    it deletes a conversation. A login refreshed by an Agent Server older than
    that fix is lost.
  - **Fix:** sign in again with a login that only OpenHands uses, so its
    refreshes never sign out your own `codex` CLI:

    ```sh
    mkdir -p ~/.openhands/codex-login
    CODEX_HOME=~/.openhands/codex-login codex login --device-auth
    ```

    Then paste the contents of `~/.openhands/codex-login/auth.json` into the
    `CODEX_AUTH_JSON` secret.

  - **Limit:** two sandboxes that run at the same time can still race. If one
    refreshes the login, the other cannot refresh it afterwards; start a new
    conversation for that agent.
