#!/usr/bin/env node
/**
 * Agent Canvas from the terminal.
 *
 * A thin entry: everything is in `scripts/tui/`, so the same code can be
 * exercised by a test without spawning a process.
 */

import process from "node:process";
import { main } from "../scripts/tui/main.mjs";

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    // Named rather than a stack trace by default: the reader is at a prompt,
    // not in a debugger. OH_TUI_DEBUG gets the trace.
    if (process.env.OH_TUI_DEBUG) {
      console.error(error);
    } else {
      console.error(`${error?.name ?? "Error"}: ${error?.message ?? error}`);
    }
    process.exit(1);
  });
