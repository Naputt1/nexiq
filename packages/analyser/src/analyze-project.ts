import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { analyzeProject } from "./lib.ts";
import { getViteConfig } from "./analyzer/utils.ts";
import minimist from "minimist";

const args = minimist(process.argv.slice(2));

const SRC_DIR = args._[0] || "./sample-src";
const OUT_FILE = args._[1] || "./out/graph.json";
const PUBLIC_FILE = args._[2] || "./ui/public/graph.json";
const SQLITE_FILE = args.sqlite;

const CACHE_FILE = args.cache || OUT_FILE;

export async function main() {
  const viteConfigPath = getViteConfig(SRC_DIR);
  console.log("viteConfigPath", viteConfigPath);
  console.log(`Analyzing project at ${SRC_DIR} using analyzeProject...`);

  const threads =
    args.threads !== undefined ? parseInt(args.threads) : os.cpus().length;
  const useThreads = args["no-threads"] ? 1 : threads;

  const graph = await analyzeProject(SRC_DIR, {
    cacheFile: CACHE_FILE,
    sqlitePath: SQLITE_FILE,
    fileWorkerThreads: useThreads,
  });

  fs.mkdirSync(path.dirname(PUBLIC_FILE), { recursive: true });
  fs.writeFileSync(PUBLIC_FILE, JSON.stringify(graph, null, 2));
  console.log(`Graph written to ${PUBLIC_FILE}`);

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(graph, null, 2));
  console.log(`Graph written to ${OUT_FILE}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
