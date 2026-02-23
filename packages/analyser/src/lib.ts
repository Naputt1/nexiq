import fs from "node:fs";
import path from "node:path";
import { PackageJson } from "./db/packageJson.js";
import analyzeFiles from "./analyzer/index.js";
import { getFiles, getViteConfig } from "./analyzer/utils.js";
import type { JsonData, ReactMapConfig } from "shared";
import { SqliteDB } from "./db/sqlite.js";

export async function analyzeProject(
  srcDir: string,
  cacheFile?: string,
  ignorePatterns?: string[],
  sqlitePath?: string,
): Promise<JsonData> {
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

  const graph = await analyzeFiles(
    srcDir,
    viteConfigPath,
    files,
    packageJson,
    cacheData,
    sqlite,
  );

  if (sqlite) {
    sqlite.close();
  }

  return graph;
}
