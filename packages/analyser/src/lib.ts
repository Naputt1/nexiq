import fs from "node:fs";
import path from "node:path";
import type { JsonData, NexiqConfig } from "@nexiq/shared";
import { getWorkspacePatterns } from "@nexiq/shared";
import analyzeFiles from "./analyzer/index.ts";
import { getFiles, getViteConfig } from "./analyzer/utils.ts";
import { CentralMaster } from "./centralMaster.ts";
import { PackageJson } from "./db/packageJson.ts";
import { SqliteDB } from "./db/sqlite.ts";
import type { AnalyzeProjectOptions } from "./types.ts";

function normalizeOptions(
  cacheFileOrOptions?: string | AnalyzeProjectOptions,
  ignorePatterns?: string[],
  sqlitePath?: string,
): AnalyzeProjectOptions {
  if (cacheFileOrOptions && typeof cacheFileOrOptions === "object") {
    return cacheFileOrOptions;
  }

  return {
    cacheFile: cacheFileOrOptions,
    ignorePatterns,
    sqlitePath,
  };
}

export async function analyzeProject(
  srcDir: string,
  cacheFileOrOptions?: string | AnalyzeProjectOptions,
  ignorePatterns?: string[],
  sqlitePath?: string,
): Promise<JsonData> {
  const options = normalizeOptions(
    cacheFileOrOptions,
    ignorePatterns,
    sqlitePath,
  );
  const viteConfigPath = getViteConfig(srcDir);

  const activeIgnorePatterns =
    options.ignorePatterns ||
    (() => {
      const configPath = path.join(srcDir, "nexiq.config.json");
      if (fs.existsSync(configPath)) {
        try {
          const config: NexiqConfig = JSON.parse(
            fs.readFileSync(configPath, "utf-8"),
          );
          return config.ignorePatterns;
        } catch (e) {
          console.warn("Failed to load config", e);
        }
      }
      return undefined;
    })();

  let cacheData = undefined;
  if (options.cacheFile && fs.existsSync(options.cacheFile)) {
    try {
      cacheData = JSON.parse(fs.readFileSync(options.cacheFile, "utf-8"));
    } catch (e) {
      console.warn("Failed to load cache", e);
    }
  }

  const isMonorepo =
    options.monorepo ?? getWorkspacePatterns(srcDir).length > 0;

  if (isMonorepo) {
    const master = new CentralMaster({
      ...options,
      srcDir,
      cacheData,
      ignorePatterns: activeIgnorePatterns || [],
    });
    return master.analyzeWorkspace();
  }

  const packageJson = new PackageJson(srcDir);
  const files = getFiles(srcDir, activeIgnorePatterns || []);
  let sqlite: SqliteDB | undefined;

  if (options.sqlitePath) {
    sqlite = new SqliteDB(options.sqlitePath);
  }

  try {
    return await analyzeFiles(
      srcDir,
      viteConfigPath,
      files,
      packageJson,
      cacheData,
      sqlite,
      options.fileWorkerThreads,
    );
  } finally {
    sqlite?.close();
  }
}
