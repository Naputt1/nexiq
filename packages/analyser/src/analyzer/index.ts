import type { JsonData } from "@nexiq/shared";
import type { PackageJson } from "../db/packageJson.ts";
import type { SqliteDB } from "../db/sqlite.ts";
import type { PhaseCallback } from "../types.ts";
import { PackageMaster } from "../packageMaster.ts";

async function analyzeFiles(
  SRC_DIR: string,
  viteConfigPath: string | null,
  files: string[],
  packageJson: PackageJson,
  cacheData?: JsonData,
  sqlite?: SqliteDB,
  threads?: number,
  onPhase?: PhaseCallback,
) {
  const master = new PackageMaster({
    srcDir: SRC_DIR,
    viteConfigPath,
    files,
    packageJson,
    cacheData,
    sqlite,
    threads,
    onPhase,
  });
  const summary = await master.analyzePackage();
  return summary.graph;
}

export default analyzeFiles;
