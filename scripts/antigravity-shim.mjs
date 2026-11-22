/**
 * The sandbox half of the Antigravity bridge, as a reviewable artifact.
 *
 * A sandbox cannot see this repository, so the shim has to travel inside the
 * profile's `acp_command` rather than as a file. That is no reason for it to
 * be an opaque blob somebody pasted into a shell once: it is generated here,
 * from source that can be read and tested, so a change to it is a change to a
 * file rather than to a base64 string nobody can diff.
 *
 * It carries no secret. The token arrives in the process environment, put
 * there by the agent server's own secret store — the agent-profile store is
 * documented as secret-free at rest, and a shared secret baked into a launch
 * command is readable by anyone who can read a profile and cannot be rotated
 * without rewriting one.
 */

/** The environment variable the bridge and the shim agree on. */
export const BRIDGE_TOKEN_ENV = "OH_ANTIGRAVITY_BRIDGE_TOKEN";

/**
 * The shim, as Python source.
 *
 * Python because every agent-server image has it and the shim must not need
 * anything installed. Two threads rather than `select`: one pumps stdin to
 * the socket and one pumps the socket to stdout, which is the whole job.
 */
export function shimSource({
  host = "172.17.0.1",
  port = 8771,
  tokenEnv = BRIDGE_TOKEN_ENV,
  connectTimeout = 30,
} = {}) {
  return `import os,socket,sys,threading
token=os.environ.get(${JSON.stringify(tokenEnv)})
if not token:
    sys.stderr.write(
        "The Antigravity bridge token is not in this sandbox's environment. "
        "Add ${tokenEnv} to the agent server's secrets so the profile "
        "receives it; it is deliberately not stored in the profile itself.\\n")
    raise SystemExit(2)
try:
    s=socket.create_connection((${JSON.stringify(host)},${port}),timeout=${connectTimeout})
except OSError as exc:
    sys.stderr.write(
        "Could not reach the Antigravity bridge at ${host}:${port}: %s. "
        "It runs on the host, where the Google login is; start it with "
        "oh-antigravity-bridge or set ${tokenEnv} in .env so the stack "
        "does.\\n" % exc)
    raise SystemExit(2)
# The connect timeout stays on the socket unless it is taken off, and then
# every read gives up after that long with nothing arriving. A tool the CLI
# runs for minutes -- a test suite, a search -- is minutes of nothing on this
# socket, so the shim died at the first long tool, its stdout closed, and
# the sandbox recorded "Connection closed". A turn has no deadline here.
s.settimeout(None)
s.sendall((token+"\\n").encode())
def up():
    while True:
        line=sys.stdin.buffer.readline()
        if not line: break
        s.sendall(line)
    try: s.shutdown(socket.SHUT_WR)
    except OSError: pass
threading.Thread(target=up,daemon=True).start()
for line in s.makefile("rb"):
    sys.stdout.buffer.write(line); sys.stdout.buffer.flush()
`;
}

/**
 * The `acp_command` an Antigravity profile runs.
 *
 * Base64 so a multi-line program survives a single-string command field, not
 * to hide anything: `shimSource` is the readable original and the test
 * asserts the two agree.
 */
export function shimCommand(options = {}) {
  const encoded = Buffer.from(shimSource(options), "utf8").toString("base64");
  return `python3 -c "import base64;exec(base64.b64decode('${encoded}'))"`;
}
