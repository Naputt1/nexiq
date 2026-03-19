import { describe, it, expect } from "vitest";
import analyzeFiles from "./analyzer/index.js";
import { getFiles, getViteConfig } from "./analyzer/utils.js";
import { PackageJson } from "./db/packageJson.js";
import path from "path";
import fs from "fs";
import os from "os";
import type { SnapshotData } from "./types/test.js";
import { SqliteDB } from "./db/sqlite.js";

describe("analyser cache snapshots", () => {
  const projectName = "cache";
  it(`should match snapshot for ${projectName}`, async () => {
    const projectPath = path.resolve(
      process.cwd(),
      `../sample-project/${projectName}`,
    );
    const packageJson = new PackageJson(projectPath);
    const viteConfigPath = getViteConfig(projectPath);
    const files = getFiles(projectPath);

    const graph = await analyzeFiles(projectPath, viteConfigPath, files, packageJson);

    const snapshotPath = path.resolve(
      process.cwd(),
      `test/snapshots/${projectName}.json`,
    );
    const snapshotData: SnapshotData = JSON.parse(
      fs.readFileSync(snapshotPath, "utf-8"),
    );

    // Compare the result with the stored snapshot
    // We strip the absolute 'src' path as it changes between environments
    const result: SnapshotData = JSON.parse(JSON.stringify(graph));
    delete result.src;

    // Strip fingerPrint as it contains timestamps
    for (const file of Object.values(result.files)) {
      delete file.fingerPrint;
    }

    expect(result).toEqual(snapshotData);
  });

  const projectNameNew = "cache-new";
  it(`should match snapshot for ${projectNameNew}`, async () => {
    const projectPath = path.resolve(
      process.cwd(),
      `../sample-project/${projectNameNew}`,
    );
    const packageJson = new PackageJson(projectPath);
    const viteConfigPath = getViteConfig(projectPath);
    const files = getFiles(projectPath);

    const cachePath = path.resolve(
      process.cwd(),
      `test/snapshots/${projectName}.json`,
    );

    let cacheData = undefined;
    if (fs.existsSync(cachePath)) {
      try {
        cacheData = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
      } catch (e) {
        console.warn("Failed to load cache", e);
      }
    }

    const graph = await analyzeFiles(
      projectPath,
      viteConfigPath,
      files,
      packageJson,
      cacheData,
    );

    const snapshotPath = path.resolve(
      process.cwd(),
      `test/snapshots/${projectNameNew}.json`,
    );
    const snapshotData: SnapshotData = JSON.parse(
      fs.readFileSync(snapshotPath, "utf-8"),
    );

    // Compare the result with the stored snapshot
    // We strip the absolute 'src' path as it changes between environments
    const result: SnapshotData = JSON.parse(JSON.stringify(graph));
    delete result.src;

    // Strip fingerPrint as it contains timestamps
    for (const file of Object.values(result.files)) {
      delete file.fingerPrint;
    }

    expect(result).toEqual(snapshotData);
  });

  it("should cache analysis results in SQLite", async () => {
    const projectName = "simple";
    const projectPath = path.resolve(
      process.cwd(),
      `../sample-project/${projectName}`,
    );
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexiq-sqlite-test-"));
    const sqlitePath = path.join(tmpDir, "test.sqlite");
    
    // Copy sample project to tmp dir to avoid side effects
    fs.cpSync(projectPath, tmpDir, { recursive: true });
    
    const packageJson = new PackageJson(tmpDir);
    const viteConfigPath = getViteConfig(tmpDir);
    const files = getFiles(tmpDir);

    // 1. First run - should analyze and save to SQLite
    const sqlite = new SqliteDB(sqlitePath);
    const firstGraph = await analyzeFiles(
      tmpDir,
      viteConfigPath,
      files,
      packageJson,
      undefined,
      sqlite,
    );
    sqlite.close();

    // Verify it saved something
    const sqlite2 = new SqliteDB(sqlitePath);
    const cachedFile = sqlite2.loadFileResults("/" + files[0]);
    expect(cachedFile).toBeDefined();
    sqlite2.close();

    // 2. Second run - should load from SQLite and skip analysis
    // We can verify this by checking if it still works even if we delete the source file 
    // (Wait, analyzeFiles still checks if file exists on disk to calculate hash)
    // So we'll just check if the output is the same.
    const sqlite3 = new SqliteDB(sqlitePath);
    const secondGraph = await analyzeFiles(
      tmpDir,
      viteConfigPath,
      files,
      packageJson,
      undefined,
      sqlite3,
    );
    sqlite3.close();

    // Basic equality check (excluding src path)
    expect(Object.keys(secondGraph.files)).toEqual(Object.keys(firstGraph.files));
    
    // Cleanup
    fs.rmSync(tmpDir, { recursive: true });
  });
});
