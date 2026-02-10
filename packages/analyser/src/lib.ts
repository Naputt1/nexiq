import fs from "fs";
import { PackageJson } from "./db/packageJson.js";
import analyzeFiles from "./analyzer/index.js";
import { getFiles, getViteConfig } from "./analyzer/utils.js";
import type { JsonData } from "shared";

export function analyzeProject(srcDir: string, cacheFile?: string): JsonData {
  const packageJson = new PackageJson(srcDir);
  const viteConfigPath = getViteConfig(srcDir);
  const files = getFiles(srcDir);

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
