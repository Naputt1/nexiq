import fs from "fs";
import path from "path";
import { PackageJson } from "./db/packageJson.js";
import analyzeFiles from "./analyzer/index.js";
import { getFiles, getViteConfig } from "./analyzer/utils.js";
import minimist from "minimist";
import { SqliteDB } from "./db/sqlite.js";
import type { ComponentInfoRender } from "shared";

const args = minimist(process.argv.slice(2));

const SRC_DIR = args._[0] || "./sample-src";
const OUT_FILE = args._[1] || "./out/graph.json";
const PUBLIC_FILE = args._[2] || "./ui/public/graph.json";
const SQLITE_FILE = args.sqlite;

const CACHE_FILE = args.cache || OUT_FILE;

const CACHE = args.cache ?? true;

export function main() {
  const packageJson = new PackageJson(SRC_DIR);

  const viteConfigPath = getViteConfig(SRC_DIR);
  console.log("viteConfigPath", viteConfigPath);
  const files = getFiles(SRC_DIR);
  // fs.writeFileSync("./out/files.json", JSON.stringify(files));
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

  const graph = analyzeFiles(
    SRC_DIR,
    viteConfigPath,
    files,
    packageJson,
    cacheData,
    sqlite,
  );

  if (sqlite) {
    // 1. Add all files and symbols first
    for (const [filePath, file] of Object.entries(graph.files)) {
      sqlite.addFile(filePath, file.hash);
      for (const variable of Object.values(file.var)) {
        sqlite.addSymbol({ ...variable, file: filePath });
      }
    }

    // 2. Add all renders (now that symbols exist)
    for (const [filePath, file] of Object.entries(graph.files)) {
      for (const variable of Object.values(file.var)) {
        const addRendersRecursive = (
          renders: Record<string, ComponentInfoRender>,
          scopeId: string,
          parentId?: string,
        ) => {
          for (const render of Object.values(renders)) {
            sqlite!.addRender({
              ...render,
              file: filePath,
              scope_symbol_id: scopeId,
              parent_instance_id: parentId,
            });
            if (render.children)
              addRendersRecursive(render.children, scopeId, render.instanceId);
          }
        };

        if (variable.type === "function" || variable.type === "jsx") {
          addRendersRecursive(variable.children, variable.id);
        }

        if (
          variable.type === "function" &&
          variable.return &&
          typeof variable.return !== "string" &&
          variable.return.type === "jsx"
        ) {
          addRendersRecursive(
            variable.return.children || {},
            variable.id,
          );
        }
      }
    }

    // 3. Add all edges
    for (const edge of graph.edges)
      sqlite.addEdge(edge.from, edge.to, edge.label);
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
  main();
}
