"""OpenHands -> LM Studio compatibility shim.

LM Studio's llama.cpp runtime (2.49-2.58) rejects gpt-oss output for OpenHands' tool-bearing requests with
"The model produced output that does not match the expected peg-native format" whenever tool_choice is
"auto". Forcing tool_choice="required" constrains generation to a valid tool call; OpenHands always acts
through tools (replies go through `finish`), so this matches the agent's contract. Requests without tools
(title generation, condensation) pass through unchanged, because LM Studio rejects "required" without tools.

Listens on LISTEN_HOST:LISTEN_PORT (default 172.17.0.1:1235, the Docker bridge, reachable from the host and
from sandbox containers but not the LAN) and forwards to UPSTREAM (default http://127.0.0.1:1234).
"""
import http.server
import json
import os
import urllib.error
import urllib.request

LISTEN_HOST = os.environ.get("SHIM_LISTEN_HOST", "172.17.0.1")
LISTEN_PORT = int(os.environ.get("SHIM_LISTEN_PORT", "1235"))
UPSTREAM = os.environ.get("SHIM_UPSTREAM", "http://127.0.0.1:1234")
FORWARDED_HEADERS = ("content-type", "authorization", "accept")
HOP_BY_HOP = ("transfer-encoding", "connection", "content-length", "keep-alive")


def rewrite(path, body):
    if not body or not path.rstrip("/").endswith("/chat/completions"):
        return body
    try:
        payload = json.loads(body)
    except ValueError:
        return body
    if payload.get("tools") and payload.get("tool_choice") in (None, "auto"):
        payload["tool_choice"] = "required"
        return json.dumps(payload).encode()
    return body


class Shim(http.server.BaseHTTPRequestHandler):
    def _forward(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = rewrite(self.path, self.rfile.read(length) if length else None)
        headers = {k: v for k, v in self.headers.items() if k.lower() in FORWARDED_HEADERS}
        req = urllib.request.Request(UPSTREAM + self.path, data=body, method=self.command, headers=headers)
        try:
            upstream = urllib.request.urlopen(req, timeout=900)
        except urllib.error.HTTPError as e:
            upstream = e
        except urllib.error.URLError as e:
            self.send_error(502, f"LM Studio unreachable: {e.reason}")
            return
        self.send_response(upstream.status if hasattr(upstream, "status") else upstream.code)
        for k, v in upstream.headers.items():
            if k.lower() not in HOP_BY_HOP:
                self.send_header(k, v)
        self.send_header("Connection", "close")
        self.end_headers()
        while chunk := upstream.read1(65536) if hasattr(upstream, "read1") else upstream.read(65536):
            self.wfile.write(chunk)
            self.wfile.flush()

    do_GET = do_POST = do_PUT = do_DELETE = _forward

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    http.server.ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), Shim).serve_forever()
