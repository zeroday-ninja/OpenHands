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
named Google identity and injects the session key *behind* itself. Nothing
downstream changes, and the key never crosses the network.

```sh
export OH_GOOGLE_CLIENT_ID=...            # from console.cloud.google.com
export OH_GOOGLE_CLIENT_SECRET=...
export OH_GATE_ALLOWED_EMAILS=you@gmail.com
oh-gate
```

It prints the redirect URI to register with the Google client. Run it beside a
stack that is already up; it finds the stack and the key the same way `oh` does.

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
explicit action, and it *requires* `OH_GATE_HOSTNAME`: a public address with no
name is one nobody can put a certificate on, and the redirect URI is built from
that name.

## Configuration

| Variable | Means |
|---|---|
| `OH_GOOGLE_CLIENT_ID` / `OH_GOOGLE_CLIENT_SECRET` | the OAuth client. Required. |
| `OH_GATE_ALLOWED_EMAILS` | addresses admitted, comma-separated |
| `OH_GATE_ALLOWED_DOMAINS` | whole domains admitted — the company case, where listing every colleague is not the answer |
| `OH_GATE_HOST` | what to bind. `0.0.0.0` by default, which is the LAN |
| `OH_GATE_PORT` | default 8443 |
| `OH_GATE_PUBLIC` | `1` to allow public exposure. Needs `OH_GATE_HOSTNAME` |
| `OH_GATE_SECRET` | signs the session cookie. Rotating it signs everybody out, which is the point of being able to |
| `OH_GATE_UPSTREAM` | the ingress, if not the one discovery finds |

**It refuses to start** without a client and a list. A gate that admits nobody
looks identical to one that is broken, and a gate that admits everybody looks
identical to one that is working — so both are caught at startup rather than at
the first request.

## Decisions worth knowing

**The id token's signature is not verified, deliberately.** The token comes
from a direct HTTPS exchange with Google's token endpoint using the client
secret, so its provenance is the TLS connection. Verifying a JWKS signature on
a token fetched that way would add a key fetch and a cache to prove something
already proven. What *is* checked is `aud` — a token minted for another client
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
