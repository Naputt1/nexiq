/**
 * nexiq CLI entry point.
 *
 * Usage:
 *   nexiq start [--port 3030]
 *   nexiq stop
 *   nexiq status
 *   nexiq cache [clear [--force]]
 *   nexiq --help
 */

import React from "react";
import { render } from "ink";
import { StartApp } from "./components/StartApp.js";
import { StopApp } from "./components/StopApp.js";
import { StatusApp } from "./components/StatusApp.js";
import { CacheApp } from "./components/CacheApp.js";
import { HelpApp } from "./components/HelpApp.js";
import { startServerForeground, BACKEND_PORT } from "./server-process.js";

// ---------------------------------------------------------------------------
// Argument parsing (no external dependency)
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

function hasFlag(...flags: string[]): boolean {
  return flags.some((f) => args.includes(f));
}

function getFlagValue(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return undefined;
}

// Parse port from --port or PORT env var
const portStr = getFlagValue("--port") ?? process.env.PORT;
const port = portStr ? parseInt(portStr, 10) : BACKEND_PORT;

// ---------------------------------------------------------------------------
// Subcommand routing
// ---------------------------------------------------------------------------

async function run() {
  const [command, subcommand] = args.filter((a) => !a.startsWith("-"));

  // Foreground mode: used by Electron — skips the ink UI entirely so the
  // process stays alive and writes directly to inherited stdio.
  if (hasFlag("--foreground")) {
    // Only valid for `start`
    await startServerForeground(port);
    process.exit(0);
  }

  if (hasFlag("--help", "-h") || !command) {
    const { waitUntilExit } = render(<HelpApp />);
    await waitUntilExit();
    process.exit(0);
  }

  switch (command) {
    case "start": {
      const { waitUntilExit } = render(<StartApp port={port} />);
      await waitUntilExit();
      process.exit(0);
      break;
    }

    case "stop": {
      const { waitUntilExit } = render(<StopApp port={port} />);
      await waitUntilExit();
      process.exit(0);
      break;
    }

    case "status": {
      const { waitUntilExit } = render(<StatusApp port={port} />);
      await waitUntilExit();
      process.exit(0);
      break;
    }

    case "cache": {
      const clear = subcommand === "clear";
      const force = hasFlag("--force", "-f");
      const { waitUntilExit } = render(<CacheApp clear={clear} force={force} />);
      await waitUntilExit();
      process.exit(0);
      break;
    }

    default: {
      process.stderr.write(`Unknown command: ${command}\n\n`);
      const { waitUntilExit } = render(<HelpApp />);
      await waitUntilExit();
      process.exit(1);
    }
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
