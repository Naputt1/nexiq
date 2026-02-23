import fs from "fs";
import path from "path";
import { PackageJson } from "./db/packageJson.js";
import analyzeFiles from "./analyzer/index.js";
import { getFiles, getViteConfig } from "./analyzer/utils.js";
import type { JsonData, ReactMapConfig, ComponentInfoRender } from "shared";
import { SqliteDB } from "./db/sqlite.js";

export function analyzeProject(
  srcDir: string,
  cacheFile?: string,
  ignorePatterns?: string[],
  sqlitePath?: string,
): JsonData {
  const packageJson = new PackageJson(srcDir);
  const viteConfigPath = getViteConfig(srcDir);

  const activeIgnorePatterns =
    ignorePatterns ||
    (() => {
      const configPath = path.join(srcDir, "react.map.config.json");
      if (fs.existsSync(configPath)) {
        try {
          const config: ReactMapConfig = JSON.parse(
            fs.readFileSync(configPath, "utf-8"),
          );
          return config.ignorePatterns;
        } catch (e) {
          console.warn("Failed to load config", e);
        }
      }
      return undefined;
    })();

  const files = getFiles(srcDir, activeIgnorePatterns || []);

  let cacheData = undefined;
  if (cacheFile && fs.existsSync(cacheFile)) {
    try {
      cacheData = JSON.parse(fs.readFileSync(cacheFile, "utf-8"));
    } catch (e) {
      console.warn("Failed to load cache", e);
    }
  }

  let sqlite: SqliteDB | undefined;
  if (sqlitePath) {
    sqlite = new SqliteDB(sqlitePath);
  }

  const graph = analyzeFiles(
    srcDir,
    viteConfigPath,
    files,
    packageJson,
    cacheData,
    sqlite,
  );

  if (sqlite) {
    // Populate SQLite from the resulting graph
    for (const [filePath, file] of Object.entries(graph.files || {})) {
      sqlite.addFile(filePath, file.hash);
      for (const variable of Object.values(file.var || {})) {
        sqlite.addSymbol({ ...variable, file: filePath });

        // Helper to recursively add renders
        const addRendersRecursive = (
          renders: Record<string, ComponentInfoRender>,
          scopeId: string,
          parentId?: string,
        ) => {
          for (const render of Object.values(renders || {})) {
            sqlite!.addRender({
              ...render,
              file: filePath,
              scope_symbol_id: scopeId,
              parent_instance_id: parentId,
            });
            if (render.children) {
              addRendersRecursive(
                render.children || {},
                scopeId,
                render.instanceId,
              );
            }
          }
        };

        if (variable.type === "function" || variable.type === "jsx") {
          addRendersRecursive(variable.children || {}, variable.id);
        }
        if (
          variable.type === "function" &&
          variable.return &&
          typeof variable.return !== "string" &&
          variable.return.type === "jsx"
        ) {
          addRendersRecursive(variable.return.children || {}, variable.id);
        }
      }
    }

    for (const edge of graph.edges || []) {
      sqlite.addEdge(edge.from, edge.to, edge.label);
    }

    sqlite.close();
  }

  return graph;
}
