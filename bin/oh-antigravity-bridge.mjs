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
  DEFAULT_BRIDGE_PORT,
  startAntigravityBridge,
} from "../scripts/antigravity-bridge.mjs";

const USAGE = `oh-antigravity-bridge — serve Antigravity to sandboxes

  OH_ANTIGRAVITY_BRIDGE_TOKEN   required; the sandbox sends it first
  OH_ANTIGRAVITY_BRIDGE_PORT    default ${DEFAULT_BRIDGE_PORT}
  OH_ANTIGRAVITY_ADAPTER        how to start the adapter on this host,
                                default: the SDK checkout's own python

The sandbox side is an agent profile whose acp_command opens the port and
pipes stdio. See docs/REMOTE_ACCESS.md.`;

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

async function run() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(USAGE);
    return;
  }
  const token = process.env.OH_ANTIGRAVITY_BRIDGE_TOKEN?.trim();
  const bridge = await startAntigravityBridge({
    token,
    command: adapterCommand(),
    port: Number(process.env.OH_ANTIGRAVITY_BRIDGE_PORT || DEFAULT_BRIDGE_PORT),
  });
  const stop = () => void bridge.close().then(() => process.exit(0));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

run().catch((error) => {
  console.error(`${error?.name ?? "Error"}: ${error?.message ?? error}`);
  process.exit(2);
});
