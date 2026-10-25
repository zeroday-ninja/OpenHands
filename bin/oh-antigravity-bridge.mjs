#!/usr/bin/env node
/**
 * Serve Antigravity to sandboxes from the host that is already signed in.
 *
 * `agy` keeps its login in the desktop keyring, which a container has not
 * got. Rather than copy the token in or bake the CLI into the image, the
 * adapter runs here and the sandbox reaches it over the docker bridge.
 *
 * Off unless started. It opens a port that every container on this host can
 * reach, so it is token-gated and refuses any peer that is not a sandbox with
 * a workspace of its own.
 */

import process from "node:process";
import {
  BridgeRefused,
  DEFAULT_BRIDGE_HOST,
  DEFAULT_BRIDGE_PORT,
  startAntigravityBridge,
} from "../scripts/antigravity-bridge.mjs";
import { shimCommand } from "../scripts/antigravity-shim.mjs";

const USAGE = `oh-antigravity-bridge — serve Antigravity to sandboxes

  OH_ANTIGRAVITY_BRIDGE_TOKEN   required; the sandbox sends it first
  OH_ANTIGRAVITY_BRIDGE_HOST    default the docker bridge
  OH_ANTIGRAVITY_BRIDGE_PORT    default ${DEFAULT_BRIDGE_PORT}
  OH_ANTIGRAVITY_ADAPTER        how to start the adapter on this host,
                                default: the SDK checkout's own python

  --profile-command             print the acp_command for the sandbox-side
                                agent profile and exit

The sandbox side is an agent profile whose acp_command dials this port and
pipes stdio. It carries no token: that arrives from the agent server's secret
store. See docs/REMOTE_ACCESS.md.`;

function adapterCommand() {
  const configured = process.env.OH_ANTIGRAVITY_ADAPTER?.trim();
  if (configured) return configured.split(/\s+/);
  const sdk = process.env.OH_AGENT_SERVER_LOCAL_PATH?.trim();
  if (!sdk) {
    throw new BridgeRefused(
      "Set OH_ANTIGRAVITY_ADAPTER to the command that starts the adapter, " +
        "or OH_AGENT_SERVER_LOCAL_PATH to an SDK checkout.",
    );
  }
  return [
    "uv",
    "run",
    "--frozen",
    "--project",
    sdk,
    "python",
    "-m",
    "openhands.sdk.acp_servers.antigravity",
  ];
}

/**
 * Where this invocation would listen.
 *
 * The daemon and `--profile-command` read it the same way on purpose: a
 * printed command that dials a port the bridge is not on fails as "that
 * token is not this bridge's", which reads like a credential problem.
 */
function endpoint() {
  return {
    host: process.env.OH_ANTIGRAVITY_BRIDGE_HOST?.trim() || DEFAULT_BRIDGE_HOST,
    port: Number(process.env.OH_ANTIGRAVITY_BRIDGE_PORT || DEFAULT_BRIDGE_PORT),
  };
}

async function run() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(USAGE);
    return;
  }
  if (process.argv.includes("--profile-command")) {
    console.log(shimCommand(endpoint()));
    return;
  }
  const token = process.env.OH_ANTIGRAVITY_BRIDGE_TOKEN?.trim();
  const bridge = await startAntigravityBridge({
    token,
    command: adapterCommand(),
    ...endpoint(),
  });
  const stop = () => void bridge.close().then(() => process.exit(0));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

run().catch((error) => {
  console.error(`${error?.name ?? "Error"}: ${error?.message ?? error}`);
  process.exit(2);
});
