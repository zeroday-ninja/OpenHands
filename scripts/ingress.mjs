#!/usr/bin/env node
/**
 * Standalone Ingress / Reverse Proxy
 *
 * A minimal HTTP reverse proxy that routes requests to multiple backends
 * based on URL path. Completely independent of any backend implementation.
 *
 * Usage:
 *   node scripts/ingress.mjs [options]
 *   node scripts/ingress.mjs --port 8000 --route "/api/automation=http://localhost:18001" --route "/api=http://localhost:18000" --default "http://localhost:3001"
 *
 * Environment variables:
 *   INGRESS_PORT          - Port to listen on (default: 8000)
 *   INGRESS_ROUTES        - JSON object of path prefix -> backend URL
 *   INGRESS_DEFAULT       - Default backend for unmatched routes
 *   INGRESS_RUNTIME_SERVICES_INFO - Runtime services JSON appended to
 *                                   /server_info
 *
 * Route matching:
 *   - Routes are matched by longest prefix first
 *   - More specific routes take precedence (e.g., /api/automation before /api)
 */

import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { DEFAULT_BIND_HOST, resolveBindHost } from "./bind-host.mjs";
import { MARS_WEB_PREFIX, mountMarsWebBridge } from "./mars-web-bridge.mjs";
import {
  CONTROL_KEY_HEADER,
  CONTROL_PATH_PREFIX,
  CONTROL_REQUEST_MESSAGE,
  CONTROL_RESTART_PATH,
  CONTROL_STATUS_MESSAGE,
  CONTROL_STATUS_PATH,
  CONTROL_UPDATE_PATH,
} from "./self-update.mjs";
import {
  createProxyHandlers,
  createRouter,
  isBenignSocketError,
  isServerInfoRequest,
  matchesPathPrefix,
  proxyServerInfoRequest,
} from "./proxy-utils.mjs";

// ═══════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    port: 8000,
    host: null,
    routes: {},
    defaultBackend: null,
    noReferrerPrefixes: [],
    runtimeServicesInfo: null,
    controlKey: null,
    controlInfo: null,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "-p":
      case "--port":
        config.port = parseInt(args[++i], 10);
        break;
      case "-H":
      case "--host":
        config.host = args[++i];
        break;
      case "-r":
      case "--route":
        // Format: "/path=http://host:port"
        const [path, url] = args[++i].split("=");
        config.routes[path] = url;
        break;
      case "-d":
      case "--default":
        config.defaultBackend = args[++i];
        break;
      case "--no-referrer-prefix": {
        const prefix = args[++i];
        if (!prefix || !prefix.startsWith("/")) {
          throw new Error(
            `--no-referrer-prefix value must start with '/': ${prefix ?? "(empty)"}`,
          );
        }
        config.noReferrerPrefixes.push(prefix);
        break;
      }
      case "--runtime-services-info":
        config.runtimeServicesInfo = args[++i] || null;
        break;
      case "--control-key":
        config.controlKey = args[++i] || null;
        break;
      case "--control-info":
        config.controlInfo = args[++i] || null;
        break;
      case "-h":
      case "--help":
        showHelp();
        process.exit(0);
    }
  }

  return config;
}

function showHelp() {
  console.log(`
Standalone Ingress / Reverse Proxy

Routes HTTP requests to multiple backends based on URL path prefix.

USAGE:
  node scripts/ingress.mjs [options]

OPTIONS:
  -p, --port <port>           Port to listen on (default: 8000)
  -H, --host <host>           Address to bind (default: 127.0.0.1 loopback)
  -r, --route <path=url>      Add a route (can be repeated)
  -d, --default <url>         Default backend for unmatched routes
  --no-referrer-prefix <p>    Send "Referrer-Policy: no-referrer" on proxied
                              responses under <p>. For upstreams whose URL
                              carries a credential in the query string.
  --runtime-services-info     Runtime services JSON for /server_info
  --control-key <key>         Enable the stack control routes
                              (/__agent-canvas/update, /restart), guarded by
                              this key in the X-Session-API-Key header. The
                              requests are relayed to the parent launcher over
                              IPC, so this needs an IPC channel.
  --control-info <json>       Self-update capability JSON for
                              /server_info.agent_canvas_control and
                              /__agent-canvas/status
  -h, --help                  Show this help

ENVIRONMENT VARIABLES:
  INGRESS_PORT                Port to listen on
  INGRESS_HOST                Bind address (default: 127.0.0.1)
  INGRESS_ROUTES              JSON object: {"path": "url", ...}
  INGRESS_DEFAULT             Default backend URL
  INGRESS_RUNTIME_SERVICES_INFO
                              Runtime services JSON for /server_info

EXAMPLES:
  # Basic setup with agent server and automation
  node scripts/ingress.mjs \\
    --port 8000 \\
    --route "/api/automation=http://localhost:18001" \\
    --route "/api=http://localhost:18000" \\
    --route "/sockets=http://localhost:18000" \\
    --default "http://localhost:3001"

  # Using environment variables
  INGRESS_PORT=8000 \\
  INGRESS_ROUTES='{"/ api/automation":"http://localhost:18001","/api":"http://localhost:18000"}' \\
  INGRESS_DEFAULT="http://localhost:3001" \\
  node scripts/ingress.mjs

ROUTE MATCHING:
  Routes are sorted by path length (longest first), so more specific
  routes like /api/automation will match before /api.
`);
}

function buildConfig(args, env = process.env) {
  let routes = { ...args.routes };

  // Merge env routes
  if (env.INGRESS_ROUTES) {
    try {
      const envRoutes = JSON.parse(env.INGRESS_ROUTES);
      routes = { ...routes, ...envRoutes };
    } catch (e) {
      console.error("Failed to parse INGRESS_ROUTES:", e.message);
    }
  }

  return {
    port: args.port || parseInt(env.INGRESS_PORT, 10) || 8000,
    host: resolveBindHost({ flag: args.host, env: env.INGRESS_HOST }),
    routes,
    defaultBackend: args.defaultBackend || env.INGRESS_DEFAULT || null,
    noReferrerPrefixes: args.noReferrerPrefixes ?? [],
    runtimeServicesInfo:
      args.runtimeServicesInfo || env.INGRESS_RUNTIME_SERVICES_INFO || null,
    controlKey: args.controlKey || env.INGRESS_CONTROL_KEY || null,
    controlInfo: args.controlInfo || env.INGRESS_CONTROL_INFO || null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Stack control (self-update / restart)
// ═══════════════════════════════════════════════════════════════════════════

const CONTROL_BODY_LIMIT = 4096;

function readJsonBody(req, done) {
  let raw = "";
  let settled = false;
  const finish = (body) => {
    if (settled) return;
    settled = true;
    done(body);
  };
  req.on("data", (chunk) => {
    raw += chunk.toString();
    if (raw.length > CONTROL_BODY_LIMIT) finish(null);
  });
  req.on("end", () => {
    try {
      finish(raw.trim() ? JSON.parse(raw) : null);
    } catch {
      finish(null);
    }
  });
  req.on("error", () => finish(null));
}

function parseControlInfo(value) {
  if (!value) return null;
  try {
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch (error) {
    console.warn(`Ignoring invalid --control-info: ${error.message}`);
    return null;
  }
}

/**
 * The ingress is the one process the browser reaches and the launcher's
 * child, so it carries the control routes: it authenticates a request with
 * the stack's session key, relays it to the launcher over IPC, and reports
 * the launcher's progress back on the status route. The instance id tells a
 * polling browser when the replacement stack has taken over.
 */
export function createStackControl({ controlKey, controlInfo, ipc = process }) {
  const info = parseControlInfo(controlInfo);
  const state = {
    instance: randomUUID(),
    phase: "idle",
    message: null,
    updated_at: new Date().toISOString(),
  };
  const canRelay =
    typeof ipc.send === "function" && Boolean(ipc.connected ?? true);
  const enabled = Boolean(controlKey) && canRelay;

  if (canRelay && typeof ipc.on === "function") {
    ipc.on("message", (message) => {
      if (!message || message.type !== CONTROL_STATUS_MESSAGE) return;
      state.phase = message.phase ?? state.phase;
      state.message = message.message ?? null;
      state.updated_at = new Date().toISOString();
    });
  }

  const serverInfoFields = () => ({
    agent_canvas_control: {
      instance: state.instance,
      enabled,
      ...(info ?? {}),
    },
  });

  const status = () => ({
    instance: state.instance,
    enabled,
    phase: state.phase,
    message: state.message,
    updated_at: state.updated_at,
    ...(info ?? {}),
  });

  const json = (res, code, body) => {
    res.writeHead(code, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(body));
  };

  const handle = (req, res) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (!pathname.startsWith(`${CONTROL_PATH_PREFIX}/`)) return false;

    if (pathname === CONTROL_STATUS_PATH) {
      if (req.method !== "GET" && req.method !== "HEAD") {
        json(res, 405, { error: "method_not_allowed" });
        return true;
      }
      json(res, 200, status());
      return true;
    }

    const action =
      pathname === CONTROL_UPDATE_PATH
        ? "update"
        : pathname === CONTROL_RESTART_PATH
          ? "restart"
          : null;
    if (!action) {
      json(res, 404, { error: "not_found" });
      return true;
    }
    if (req.method !== "POST") {
      json(res, 405, { error: "method_not_allowed" });
      return true;
    }
    if (!enabled) {
      json(res, 503, { error: "control_unavailable" });
      return true;
    }
    const presented = req.headers[CONTROL_KEY_HEADER];
    if (typeof presented !== "string" || presented !== controlKey) {
      json(res, 401, { error: "unauthorized" });
      return true;
    }
    const supported =
      action === "update"
        ? info?.self_update?.supported === true
        : info?.restart?.supported !== false;
    if (!supported) {
      json(res, 409, { error: "unsupported", status: status() });
      return true;
    }
    if (state.phase !== "idle" && state.phase !== "failed") {
      json(res, 409, { error: "busy", status: status() });
      return true;
    }
    // The body may name the release the browser saw (`target_version`), so
    // a checkout can merge that release's tag.
    readJsonBody(req, (body) => {
      const targetVersion =
        typeof body?.target_version === "string"
          ? body.target_version.trim() || null
          : null;
      state.phase = action === "update" ? "updating" : "restarting";
      state.message = null;
      state.updated_at = new Date().toISOString();
      try {
        ipc.send({
          type: CONTROL_REQUEST_MESSAGE,
          action,
          target_version: targetVersion,
        });
      } catch (error) {
        state.phase = "failed";
        state.message = `Could not reach the launcher: ${error.message}`;
        json(res, 500, { error: "relay_failed", status: status() });
        return;
      }
      json(res, 202, { ok: true, action, status: status() });
    });
    return true;
  };

  return { handle, serverInfoFields, status, enabled };
}

// ═══════════════════════════════════════════════════════════════════════════
// Server
// ═══════════════════════════════════════════════════════════════════════════

export function startIngress(config) {
  const route = createRouter(config.routes, config.defaultBackend);
  const proxy = createProxyHandlers({ label: `ingress:${config.port}` });
  const uninstallDiagnostics = proxy.installDiagnostics();
  // DigitalOcean Managed Agents for the browser: with MARS_WEB=1, host the MARS
  // bridge and proxies to sessions' tunnel listeners, behind the session key
  // (MARS_WEB_KEY; dev-with-automation passes the stack's key).
  const marsWeb = mountMarsWebBridge({ host: config.host });
  const control = createStackControl({
    controlKey: config.controlKey,
    controlInfo: config.controlInfo,
    ipc: config.ipc ?? process,
  });

  const noReferrerPrefixes = config.noReferrerPrefixes ?? [];

  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    if (marsWeb?.handleHttp(req, res)) return;
    // Nothing behind this ingress serves `/mars/*` when the bridge is not
    // mounted. The page probes `/mars/health` before it renders; letting that
    // fall through to the SPA backend answers it with the whole app shell
    // (a megabyte of inlined CSS in dev) instead of a short no.
    if (!marsWeb && matchesPathPrefix(url, MARS_WEB_PREFIX)) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }
    if (control.handle(req, res)) return;
    const backend = route(url);

    if (!backend) {
      res.writeHead(503);
      res.end("No backend configured for this route");
      return;
    }

    // See the matching note in static-server.mjs: the editor's URL carries
    // agent-server's session key as a query parameter, so the document must
    // not send a Referer on the subresources the workbench loads.
    if (noReferrerPrefixes.some((prefix) => matchesPathPrefix(url, prefix))) {
      res.setHeader("Referrer-Policy", "no-referrer");
    }

    if (
      (config.runtimeServicesInfo || config.controlInfo) &&
      isServerInfoRequest(req) &&
      (req.method === "GET" || req.method === "HEAD")
    ) {
      proxyServerInfoRequest(
        req,
        res,
        backend,
        config.runtimeServicesInfo,
        config.controlInfo ? control.serverInfoFields() : null,
      );
      return;
    }

    proxy.proxyHttp(req, res, backend);
  });

  // Handle WebSocket upgrades
  server.on("upgrade", (req, socket, head) => {
    if (marsWeb?.handleUpgrade(req, socket, head)) return;
    const backend = route(req.url ?? "/");

    if (!backend) {
      socket.destroy();
      return;
    }

    proxy.proxyWebSocket(req, socket, head, backend);
  });

  // Built-in protection against malformed client requests that can otherwise
  // bubble up as unhandled errors on the underlying TCP socket.
  server.on("clientError", (err, socket) => {
    if (!isBenignSocketError(err)) {
      console.error("Client error:", err.message);
    }
    if (socket.writable) {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    } else {
      socket.destroy();
    }
  });
  server.on("close", uninstallDiagnostics);
  server.on("close", () => {
    void marsWeb?.dispose().catch(() => {});
  });

  server.listen(config.port, config.host || DEFAULT_BIND_HOST, () => {
    console.log("");
    console.log(
      "╔═══════════════════════════════════════════════════════════════╗",
    );
    console.log(
      "║  Ingress Proxy                                                ║",
    );
    console.log(
      "╠═══════════════════════════════════════════════════════════════╣",
    );
    console.log(
      `║  Listening on: http://localhost:${config.port}/`.padEnd(66) + "║",
    );
    console.log(
      "╠═══════════════════════════════════════════════════════════════╣",
    );
    console.log(
      "║  Routes:                                                      ║",
    );

    const sortedRoutes = Object.entries(config.routes).sort(
      ([a], [b]) => b.length - a.length,
    );
    for (const [path, backend] of sortedRoutes) {
      const line = `    ${path} → ${backend}`;
      console.log(`║  ${line.padEnd(61)}║`);
    }

    if (config.defaultBackend) {
      const line = `    * (default) → ${config.defaultBackend}`;
      console.log(`║  ${line.padEnd(61)}║`);
    }

    console.log(
      "║                                                               ║",
    );
    console.log(
      "╚═══════════════════════════════════════════════════════════════╝",
    );
    console.log("");
  });

  return server;
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

const isMainModule =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  const args = parseArgs();
  const config = buildConfig(args);

  if (Object.keys(config.routes).length === 0 && !config.defaultBackend) {
    console.error(
      "Error: No routes configured. Use --route or --default options.",
    );
    console.error("Run with --help for usage information.");
    process.exit(1);
  }

  startIngress(config);

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    console.log("\nShutting down...");
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log("\nShutting down...");
    process.exit(0);
  });
}
