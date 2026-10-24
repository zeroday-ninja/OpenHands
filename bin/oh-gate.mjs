#!/usr/bin/env node
/**
 * Put the dashboard behind a Google sign-in, so another machine can reach it.
 *
 * Run it beside a stack that is already up. It proxies to the ingress and
 * injects the session key behind itself, so nothing downstream changes and the
 * key never crosses the network.
 */

import process from "node:process";
import {
  GateMisconfigured,
  readGateConfig,
  startAccessGate,
} from "../scripts/access-gate.mjs";
import { discoverStack, StackNotFound } from "../scripts/stack-discovery.mjs";

async function run() {
  let config;
  try {
    config = readGateConfig();
  } catch (error) {
    if (error instanceof GateMisconfigured) {
      console.error(error.message);
      process.exit(2);
    }
    throw error;
  }

  // The gate's whole job is to hold a key the browser never sees, so it finds
  // the same key and the same stack the launcher did rather than asking for
  // them again.
  if (!config.sessionApiKey || !process.env.OH_GATE_UPSTREAM) {
    try {
      const stack = await discoverStack();
      config.upstream = process.env.OH_GATE_UPSTREAM?.trim() || stack.baseUrl;
      config.sessionApiKey = config.sessionApiKey || stack.apiKey;
    } catch (error) {
      if (error instanceof StackNotFound) {
        console.error(error.message);
        process.exit(2);
      }
      throw error;
    }
  }

  const gate = await startAccessGate(config);
  console.log(`  proxying to ${config.upstream}`);
  const stop = () => {
    void gate.close().then(() => process.exit(0));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

run().catch((error) => {
  console.error(`${error?.name ?? "Error"}: ${error?.message ?? error}`);
  process.exit(1);
});
