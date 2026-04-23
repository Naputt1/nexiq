/**
 * Utilities for managing the nexiq backend server process:
 * - Resolving the server binary path
 * - Starting / stopping the server (foreground or detached)
 * - Querying health via WebSocket ping
 * - Cache inspection / clearing
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, execSync } from "node:child_process";
import { createRequire } from "node:module";
import { WebSocket } from "ws";
import net from "node:net";

export const BACKEND_PORT = 3030;

// ~/.nexiq/ is the global cache root used by the server
const GLOBAL_NEXIQ_DIR = path.join(os.homedir(), ".nexiq");
const PID_FILE = path.join(GLOBAL_NEXIQ_DIR, "server.pid");
const LOG_FILE = path.join(GLOBAL_NEXIQ_DIR, "server.log");

// ---------------------------------------------------------------------------
// Server binary resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the path to the compiled server `index.js`.
 */
export function resolveServerDist(): string | null {
  // 1. Env override
  if (process.env.REACT_MAP_SERVER_PATH) {
    return process.env.REACT_MAP_SERVER_PATH;
  }

  // 2. Monorepo sibling path
  // We try multiple ways to get the current file directory
  let currentDir = "";
  try {
    currentDir = path.dirname(new URL(import.meta.url).pathname);
  } catch {
    // @ts-ignore
    currentDir = typeof __dirname !== "undefined" ? __dirname : process.cwd();
  }

  const siblingPath = path.resolve(
    currentDir,
    "../../..", // dist/cli.js -> dist -> nexiq-cli -> packages -> nexiq root
    "server",
    "dist",
    "index.js",
  );
  if (fs.existsSync(siblingPath)) {
    return siblingPath;
  }

  // 3. Resolve from installed @nexiq/server package
  try {
    const require = createRequire(import.meta.url || `file://${process.cwd()}/index.js`);
    const resolved = require.resolve("@nexiq/server");
    if (fs.existsSync(resolved)) return resolved;
  } catch {
    // not installed
  }

  return null;
}

// ---------------------------------------------------------------------------
// Port check
// ---------------------------------------------------------------------------

export async function isPortOpen(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const onError = () => {
      socket.destroy();
      resolve(false);
    };
    socket.setTimeout(400);
    socket.once("error", onError);
    socket.once("timeout", onError);
    socket.connect(port, host, () => {
      socket.destroy();
      resolve(true);
    });
  });
}

export async function isServerAlive(port: number = BACKEND_PORT): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    const timeout = setTimeout(() => {
      ws.terminate();
      resolve(false);
    }, 600);

    ws.on("open", () => {
      clearTimeout(timeout);
      ws.terminate();
      resolve(true);
    });

    ws.on("error", () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

// ---------------------------------------------------------------------------
// PID file helpers
// ---------------------------------------------------------------------------

function ensureNexiqDir() {
  if (!fs.existsSync(GLOBAL_NEXIQ_DIR)) {
    fs.mkdirSync(GLOBAL_NEXIQ_DIR, { recursive: true });
  }
}

function writePid(pid: number) {
  ensureNexiqDir();
  fs.writeFileSync(PID_FILE, `${pid}\n`, "utf8");
}

function readPid(): number | null {
  if (!fs.existsSync(PID_FILE)) return null;
  const raw = fs.readFileSync(PID_FILE, "utf8").trim();
  const pid = parseInt(raw, 10);
  return isNaN(pid) ? null : pid;
}

function clearPid() {
  if (fs.existsSync(PID_FILE)) {
    fs.unlinkSync(PID_FILE);
  }
}

function isPidAlive(pid: number): boolean {
  try {
    // Signal 0 = check existence without sending a real signal
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function pidFileModifiedAt(): Date | null {
  if (!fs.existsSync(PID_FILE)) return null;
  return fs.statSync(PID_FILE).mtime;
}

// ---------------------------------------------------------------------------
// Start / Stop
// ---------------------------------------------------------------------------

export interface StartResult {
  ok: boolean;
  pid?: number;
  port?: number;
  alreadyRunning?: boolean;
  error?: string;
}

/**
 * Start the server in the foreground (no detach).
 * The process stays alive as long as the CLI is running.
 * Callers that want daemon mode should use startDetached().
 */
export async function startServerForeground(port: number = BACKEND_PORT): Promise<never> {
  const serverDist = resolveServerDist();
  if (!serverDist) {
    console.error("Could not find the nexiq server. Please build it first (pnpm build).");
    process.exit(1);
  }

  const child = spawn("node", [serverDist], {
    stdio: ["inherit", "inherit", "inherit", "ipc"],
    env: { ...process.env, PORT: String(port), NODE_ENV: "production" },
  });

  child.on("error", (err) => {
    console.error("Server failed to start:", err.message);
    process.exit(1);
  });

  await new Promise<void>((_, reject) =>
    child.on("exit", (code) => reject(new Error(`Server exited with code ${code}`))),
  );

  process.exit(0);
}

/**
 * Start the server detached (daemon mode) — writes PID file.
 */
export async function startServerDetached(port: number = BACKEND_PORT): Promise<StartResult> {
  // Already alive?
  if (await isServerAlive(port)) {
    const pid = readPid();
    return { ok: true, alreadyRunning: true, pid: pid ?? undefined, port };
  }

  const serverDist = resolveServerDist();
  if (!serverDist) {
    return { ok: false, error: "Could not find the nexiq server binary. Run `pnpm build` in packages/server first." };
  }

  ensureNexiqDir();

  const logStream = fs.openSync(LOG_FILE, "a");

  const child = spawn("node", [serverDist], {
    detached: true,
    stdio: ["ignore", logStream, logStream, "ipc"],
    env: { ...process.env, PORT: String(port), NODE_ENV: "production" },
  });

  const pid = child.pid;
  if (!pid) {
    return { ok: false, error: "Failed to get PID from spawned process" };
  }

  child.unref();
  writePid(pid);

  // Wait up to 4s for the server to be reachable
  const start = Date.now();
  while (Date.now() - start < 4000) {
    await sleep(300);
    if (await isServerAlive(port)) {
      return { ok: true, pid, port };
    }
  }

  // Server didn't come up — clean up
  clearPid();
  return { ok: false, error: "Server started but did not become reachable within 4s. Check ~/.nexiq/server.log" };
}

export interface StopResult {
  ok: boolean;
  message: string;
}

export async function stopServer(): Promise<StopResult> {
  const pid = readPid();

  if (!pid) {
    // Check if something is on the port even without a PID file
    if (await isServerAlive()) {
      return { ok: false, message: "Server appears to be running but no PID file found. Stop it manually." };
    }
    return { ok: true, message: "Server is not running." };
  }

  if (!isPidAlive(pid)) {
    clearPid();
    return { ok: true, message: `Server (PID ${pid}) was already stopped. Cleaned up PID file.` };
  }

  try {
    process.kill(pid, "SIGTERM");
    // Wait up to 3s for it to die
    const start = Date.now();
    while (Date.now() - start < 3000) {
      await sleep(200);
      if (!isPidAlive(pid)) break;
    }
    clearPid();
    return { ok: true, message: `Server (PID ${pid}) stopped.` };
  } catch (err) {
    return { ok: false, message: `Failed to stop server: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export interface ServerStatus {
  running: boolean;
  pid?: number;
  port?: number;
  uptimeMs?: number;
  serverDist: string | null;
  logFile: string;
}

export async function getServerStatus(port: number = BACKEND_PORT): Promise<ServerStatus> {
  const pid = readPid();
  const alive = await isServerAlive(port);
  const startedAt = pidFileModifiedAt();

  return {
    running: alive,
    pid: pid ?? undefined,
    port: alive ? port : undefined,
    uptimeMs: alive && startedAt ? Date.now() - startedAt.getTime() : undefined,
    serverDist: resolveServerDist(),
    logFile: LOG_FILE,
  };
}

// ---------------------------------------------------------------------------
// Cache inspection
// ---------------------------------------------------------------------------

export interface CacheEntry {
  /** Project path (dir name inside ~/.nexiq/<hash>/<projectPath>) */
  label: string;
  /** Absolute path to the cache dir */
  cachePath: string;
  /** Total size in bytes */
  sizeBytes: number;
  /** Last modified time */
  lastModified: Date;
}

function dirSizeBytes(dirPath: string): number {
  let total = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += dirSizeBytes(full);
      } else {
        try {
          total += fs.statSync(full).size;
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore unreadable dirs
  }
  return total;
}

export function getCacheEntries(): CacheEntry[] {
  if (!fs.existsSync(GLOBAL_NEXIQ_DIR)) return [];

  const entries: CacheEntry[] = [];

  // The server stores project caches directly in ~/.nexiq/<encoded-project-path>/
  const items = fs.readdirSync(GLOBAL_NEXIQ_DIR, { withFileTypes: true });
  for (const item of items) {
    if (!item.isDirectory()) continue;
    const fullPath = path.join(GLOBAL_NEXIQ_DIR, item.name);
    const stat = fs.statSync(fullPath);
    const sizeBytes = dirSizeBytes(fullPath);
    entries.push({
      label: decodeURIComponent(item.name.replace(/_/g, "/")),
      cachePath: fullPath,
      sizeBytes,
      lastModified: stat.mtime,
    });
  }

  return entries.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
}

export function clearCacheEntries(entries: CacheEntry[]): void {
  for (const entry of entries) {
    fs.rmSync(entry.cachePath, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
