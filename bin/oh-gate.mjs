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
import { lanAddress, runGateSelfTest } from "../scripts/gate-self-test.mjs";
import {
  checkEveryRedirect,
  checkLines,
  setupLines,
} from "../scripts/gate-setup.mjs";

async function selfTest() {
  const host = lanAddress();
  if (!host) {
    console.error(
      "This machine has no LAN address, so there is nothing to check: the " +
        "claim being tested is that another machine can reach the gate.",
    );
    process.exit(2);
  }

  let stack;
  try {
    stack = await discoverStack();
  } catch (error) {
    if (error instanceof StackNotFound) {
      console.error(error.message);
      process.exit(2);
    }
    throw error;
  }

  console.log(`  checking the gate on ${host}, in front of ${stack.baseUrl}`);
  const report = await runGateSelfTest({
    upstream: stack.baseUrl,
    sessionApiKey: stack.apiKey,
    host,
  });
  console.log(`  listening on ${report.base}\n`);
  for (const check of report.checks) {
    console.log(`  ${check.ok ? "ok  " : "FAIL"}  ${check.name}`);
    console.log(`          ${check.detail}`);
  }
  console.log(
    report.ok
      ? "\nThe gate holds. The identity was minted by a loopback stub, because " +
          "a\nGoogle client belongs to a Google account; everything the gate does " +
          "with\nthat identity is the production path."
      : "\nThe gate did not hold. See the FAIL lines above.",
  );
  process.exit(report.ok ? 0 : 1);
}

async function setup() {
  const host = process.env.OH_GATE_HOST?.trim() || lanAddress() || "127.0.0.1";
  const port = Number(process.env.OH_GATE_PORT || 8443);
  const hostname = process.env.OH_GATE_HOSTNAME?.trim() || null;
  const clientId = process.env.OH_GOOGLE_CLIENT_ID?.trim() || null;

  for (const line of setupLines({ host, port, hostname, clientId })) {
    console.log(line);
  }
  if (!clientId) {
    process.exit(0);
  }

  console.log("\n  asking Google…");
  const report = await checkEveryRedirect({ clientId, host, port, hostname });
  for (const line of checkLines(report)) console.log(line);
  process.exit(report.ok ? 0 : 1);
}

async function run() {
  if (process.argv.includes("setup")) {
    await setup();
    return;
  }
  if (process.argv.includes("--self-test")) {
    await selfTest();
    return;
  }

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
