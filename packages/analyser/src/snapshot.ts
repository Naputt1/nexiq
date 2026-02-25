import fs from "fs";
import path from "path";
import { PackageJson } from "./db/packageJson.js";
import analyzeFiles from "./analyzer/index.js";
import { getFiles, getViteConfig } from "./analyzer/utils.js";
import minimist from "minimist";
import assert from "assert";
import type { SnapshotData } from "./types/test.js";

const args = minimist(process.argv.slice(2));

const samples = args._[0]
  ? [args._[0]]
  : [
      "simple",
      "complex",
      "props",
      "hook",
      "props-complex",
      "destructuring-hook",
      "jsx-variable",
      "forward-ref",
      "destructured-export",
      "ts-method-signature",
      "cache",
      "cache-new",
      "async-functions",
      "destructuring-dependency",
    ];

export async function runSnapshot(sample: string) {
  const SRC_DIR = `../sample-project/${sample}`;
  const OUT_FILE = `./test/snapshots/${sample}.json`;
  const PUBLIC_FILE = "../ui/public/graph.json";

  assert(fs.existsSync(SRC_DIR), "sample not found: " + SRC_DIR);

  const packageJson = new PackageJson(SRC_DIR);

  const viteConfigPath = getViteConfig(SRC_DIR);
  const files = getFiles(SRC_DIR);

  let cacheData = undefined;
  if (sample === "cache-new") {
    const CACHE_FILE = path.resolve(
      process.cwd(),
      `./test/snapshots/cache.json`,
    );
    if (fs.existsSync(CACHE_FILE)) {
      try {
        cacheData = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
        console.log("Loaded cache", CACHE_FILE);
      } catch (e) {
        console.warn("Failed to load cache", e);
      }
    }
  }

  const graph: SnapshotData = await analyzeFiles(
    SRC_DIR,
    viteConfigPath,
    files,
    packageJson,
    cacheData,
    undefined,
    1,
  );
  delete graph.src;
  for (const file of Object.values(graph.files)) {
    delete file.fingerPrint;
  }

  fs.mkdirSync(path.dirname(PUBLIC_FILE), { recursive: true });
  fs.writeFileSync(PUBLIC_FILE, JSON.stringify(graph, null, 2));
  console.log(`Graph written to ${PUBLIC_FILE}`);

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(graph, null, 2));
  console.log(`Graph written to ${OUT_FILE}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    for (const sample of samples) {
      await runSnapshot(sample);
    }
  })();
}
