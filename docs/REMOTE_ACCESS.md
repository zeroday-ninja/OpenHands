# Reaching the dashboard from another machine

The stack is loopback-only and authenticates with a shared session key that
the launcher injects into the served HTML. That is exactly why another machine
cannot reach it — and the two obvious fixes are both wrong:

- **exposing the key over the LAN** hands the whole stack to anyone on the
  network, which is why `applySessionKeyPolicy` already refuses to inject it on
  a non-loopback bind;
- **reinventing sign-in inside Canvas** duplicates an identity system that
  already exists, and puts credentials in a React app.

So there is a third thing: a proxy in front of the ingress that admits one
named Google identity and injects the session key _behind_ itself. Nothing
downstream changes, and the key never crosses the network.

```sh
export OH_GOOGLE_CLIENT_ID=...            # from console.cloud.google.com
export OH_GOOGLE_CLIENT_SECRET=...
export OH_GATE_ALLOWED_EMAILS=you@gmail.com
oh-gate
```

It prints the redirect URI to register with the Google client. Run it beside a
stack that is already up; it finds the stack and the key the same way `oh` does.

## Creating the Google client

```sh
oh-gate setup
```

It prints the console URL, **every** redirect URI to register — the LAN
address, loopback and `localhost`, because Google matches the redirect URI
exactly and a client registered for one of them fails on the others — and the
variables to set. Run it again once the client exists and it asks Google
whether that client works here, before you open a browser:

```
What Google says about this client:

  ok    http://192.168.4.60:8443/__oh/auth/callback
  FAIL  http://localhost:8443/__oh/auth/callback
          redirect_uri_mismatch

The client exists, but this redirect URI is not on its list. Add the URI
printed above to the client's Authorised redirect URIs, exactly, including
the port.
```

No credentials are sent: the client secret is not part of that request, and no
sign-in is started.

### Why `device_id` and `device_name` are on the authorize URL

Because Google refuses a LAN redirect without them:

```
invalid_request: device_id and device_name are required for
private IP: http://192.168.4.60:8443/__oh/auth/callback
```

That is the address another machine on the LAN uses, so the sign-in could not
have completed without them — with any client, however correctly registered.
`device_id` is a digest of the redirect host rather than its name: Google only
needs the device to be the same one each time.

## Checking it before you have a Google client

A Google OAuth client belongs to a Google account, so it is the one part of
this that cannot be set up from here. Everything else can be checked, and
should be, on the address another machine will actually use:

```sh
oh-gate --self-test
```

It finds this host's LAN address, stands the gate up in front of the running
stack, and drives it:

```
  checking the gate on 192.168.4.60, in front of http://127.0.0.1:8000
  listening on http://192.168.4.60:39109

  ok    no unauthenticated request is answered by the stack
          8 probes, every one refused
  ok    a callback the gate did not start is refused
  ok    the allowed address signs in
  ok    the dashboard loads over the LAN once signed in
          status 200, 1055336 bytes from http://192.168.4.60:39109
  ok    the session key is absent from what was served
  ok    an API call reaches the stack with the key injected behind the gate
  ok    a verified address that is not allowed is refused
```

**One thing is substituted and nothing else: who mints the identity token.**
The issuer is a loopback stub that answers the way Google's token endpoint
answers. Everything the gate does with that answer — the state check, the
audience check, the verified-address check, the allow-list, the signed cookie,
the key injection, the key stripping — is the production path.

The issuer is passed in code and never read from the environment, deliberately.
A gate that could be pointed at another issuer by setting a variable would be a
gate anybody could forge an identity for.

What the self-test cannot tell you is whether a firewall between your machines
drops the port. To check that from the other machine, with the gate running:

```sh
curl -s -o /dev/null -w '%{http_code}\n' http://<this-host>:8443/   # expect 401
```

A `401` is the right answer there: it means the gate is reachable and refusing,
which is the whole arrangement working.

## What it will not bend

**No unauthenticated request reaches the ingress.** Not a redirect with the
body already proxied, not a `HEAD`, not an `OPTIONS` preflight. The check
happens before anything is forwarded, and the probe test walks every method
against an API path, a page path and a traversal attempt.

**The session key never leaves the gate.** It is added to the request going in
and stripped from anything going out — both the headers that could carry it and
the body, because the launcher injects it into HTML and that HTML is now
crossing a network.

**Public exposure is off until it is turned on.** `OH_GATE_PUBLIC=1` is the one
explicit action, and it _requires_ `OH_GATE_HOSTNAME`: a public address with no
name is one nobody can put a certificate on, and the redirect URI is built from
that name.

## Configuration

| Variable                                          | Means                                                                                          |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `OH_GOOGLE_CLIENT_ID` / `OH_GOOGLE_CLIENT_SECRET` | the OAuth client. Required.                                                                    |
| `OH_GATE_ALLOWED_EMAILS`                          | addresses admitted, comma-separated                                                            |
| `OH_GATE_ALLOWED_DOMAINS`                         | whole domains admitted — the company case, where listing every colleague is not the answer     |
| `OH_GATE_HOST`                                    | what to bind. `0.0.0.0` by default, which is the LAN                                           |
| `OH_GATE_PORT`                                    | default 8443                                                                                   |
| `OH_GATE_PUBLIC`                                  | `1` to allow public exposure. Needs `OH_GATE_HOSTNAME`                                         |
| `OH_GATE_SECRET`                                  | signs the session cookie. Rotating it signs everybody out, which is the point of being able to |
| `OH_GATE_UPSTREAM`                                | the ingress, if not the one discovery finds                                                    |

**It refuses to start** without a client and a list. A gate that admits nobody
looks identical to one that is broken, and a gate that admits everybody looks
identical to one that is working — so both are caught at startup rather than at
the first request.

## Decisions worth knowing

**The id token's signature is not verified, deliberately.** The token comes
from a direct HTTPS exchange with Google's token endpoint using the client
secret, so its provenance is the TLS connection. Verifying a JWKS signature on
a token fetched that way would add a key fetch and a cache to prove something
already proven. What _is_ checked is `aud` — a token minted for another client
is not a sign-in here — and `email_verified`.

**Every cookie failure answers the same way.** Expired, tampered, forged,
malformed: all `null`. Telling them apart tells an attacker which one they got.
The HMAC comparison is constant-time.

**`Secure` is set only when there is TLS to be secure over.** Setting it on a
plain LAN address makes the browser drop the cookie and loop the sign-in.

**An API call gets a 401, a page gets a redirect.** Redirecting a `fetch` to an
HTML login page produces a parse error three layers from the cause.

**A refused account is named.** The person reading it is almost always the owner
signed into the wrong Google account, and "access denied" would send them
looking for a server problem.

## Workspace tools

Nothing to add: Drive, Gmail, Calendar, Docs and Sheets are already entries in
the MCP catalog from `@openhands/extensions`, each with an OAuth connection
option. Install them from the MCP page and the agents can read company
documents and write back.

# Antigravity in a sandbox, without the sandbox holding its credential

`agy` keeps its Google login in the desktop keyring. A container has no
keyring, so the adapter running inside one cannot sign in — and the two
obvious fixes are both wrong:

- **copying the token in** puts a broad-scope Google refresh token next to
  agent-written code;
- **baking the CLI into the image** redistributes a 217 MB vendor binary and
  still needs the token.

So the credential stays where it already is. The adapter runs on the host,
which is already signed in, and the sandbox reaches it over the docker bridge
the launcher already uses — the same shape as the access gate above: hold the
secret behind the boundary and pass only the conversation across it.

Put the token in `.env` and the stack starts it for you, on the same bridge
address sandboxes already use for the API:

```sh
OH_ANTIGRAVITY_BRIDGE_TOKEN=$(openssl rand -hex 24)
```

The token is the opt-in — without it nothing starts, because this opens a port
every container on this host can reach. Run it by hand instead if you prefer:

```sh
OH_ANTIGRAVITY_BRIDGE_TOKEN=... oh-antigravity-bridge
```

Then an agent profile whose `acp_command` dials the port and pipes stdio. Ask
the bridge for it rather than assembling it by hand:

```sh
oh-antigravity-bridge --profile-command
```

What crosses is ACP's own JSON-RPC, one line at a time.

**The token is not in the profile.** The printed command reads it from
`OH_ANTIGRAVITY_BRIDGE_TOKEN` in the sandbox's environment, which the agent
server fills from its secret store:

```sh
curl -X PUT "$STACK/api/settings/secrets" -H "X-Session-API-Key: $KEY" \
  -H 'Content-Type: application/json' \
  -d '{"name":"OH_ANTIGRAVITY_BRIDGE_TOKEN","value":"...","description":"Antigravity bridge"}'
```

The agent-profile store is secret-free at rest by design, so a token baked
into a launch command is readable by anyone who can read a profile and cannot
be rotated without rewriting one. The secret store is the half of this that
already knows how to hold a secret. If the profile narrows `secret_refs`, the
token's name has to be in the list — and so does whatever the fallback runtime
needs.

Two things that will bite otherwise: the profile needs
`acp_server: "antigravity"`, or the cycle records its builder as `custom` and
the builder-share measurement counts the wrong runtime; and it needs no
session mode, because the adapter has no `session/set_mode` and answers
`-32601`. A cycle on Antigravity also wants a run timeout well above the
600-second default.

## What it will not bend

**Only a sandbox on this host.** The peer address is resolved against Docker's
own container list; anything else is refused. The port is on the docker
bridge, which something other than a sandbox could reach.

**Only that sandbox's own directory.** The host path behind `/workspace` is
read from the container's mounts rather than configured, because a stale
mapping would hand a conversation somebody else's files. A container with no
workspace of its own is refused rather than given a guess.

**Only the working directory is rewritten.** A path the sandbox invented is
left alone: it is not a path on this side, and rewriting it would point the
CLI at a directory nobody asked for.

**Off unless started.** It opens a port every container on this host can
reach, so it is token-gated, and the token is checked before the adapter is
spawned at all.

**A refusal is said on both sides.** The socket closes with the reason and the
bridge logs it with the peer address. Refusing silently and logging only the
accepted connections is how a wrong token looked identical to a bridge that
was not running.

## The trade-off, stated

A sandbox with this configured can run Antigravity turns as you. That is a
wider reach than a sandbox has by default, and narrower than giving it the
credential: the token can be rotated by restarting the bridge, the bridge can
be stopped, and nothing durable ever lands inside the container.
