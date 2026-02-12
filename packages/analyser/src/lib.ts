import fs from "fs";
import path from "path";
import { PackageJson } from "./db/packageJson.js";
import analyzeFiles from "./analyzer/index.js";
import { getFiles, getViteConfig } from "./analyzer/utils.js";
import type { JsonData, ReactMapConfig } from "shared";

export function analyzeProject(
  srcDir: string,
  cacheFile?: string,
  ignorePatterns?: string[],
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

  const graph = analyzeFiles(
    srcDir,
    viteConfigPath,
    files,
    packageJson,
    cacheData,
  );

  return graph;
}
