import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { PackageJson } from "./db/packageJson.ts";
import analyzeFiles from "./analyzer/index.ts";
import { getFiles, getViteConfig } from "./analyzer/utils.ts";
import minimist from "minimist";
import { SqliteDB } from "./db/sqlite.ts";

const args = minimist(process.argv.slice(2));

const SRC_DIR = args._[0] || "./sample-src";
const OUT_FILE = args._[1] || "./out/graph.json";
const PUBLIC_FILE = args._[2] || "./ui/public/graph.json";
const SQLITE_FILE = args.sqlite;

const CACHE_FILE = args.cache || OUT_FILE;
const CACHE = args.cache ?? true;

export async function main() {
  const packageJson = new PackageJson(SRC_DIR);

  const viteConfigPath = getViteConfig(SRC_DIR);
  console.log("viteConfigPath", viteConfigPath);
  const files = getFiles(SRC_DIR);
  console.log(`Analyzing ${files.length} files...`);

  let cacheData = undefined;
  if (CACHE && fs.existsSync(CACHE_FILE)) {
    try {
      cacheData = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
    } catch (e) {
      console.warn("Failed to load cache", e);
    }
  }

  let sqlite: SqliteDB | undefined;
  if (SQLITE_FILE) {
    sqlite = new SqliteDB(SQLITE_FILE);
  }

  const threads =
    args.threads !== undefined ? parseInt(args.threads) : os.cpus().length;
  const useThreads = args["no-threads"] ? 1 : threads;

  const graph = await analyzeFiles(
    SRC_DIR,
    viteConfigPath,
    files,
    packageJson,
    cacheData,
    sqlite,
    useThreads,
  );

  if (sqlite) {
    sqlite.close();
    console.log(`SQLite written to ${SQLITE_FILE}`);
  }

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
