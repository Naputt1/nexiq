import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { analyzeProject } from "./lib.ts";
import { normalize } from "./snapshot.ts";
import { SqliteDB } from "./db/sqlite.ts";

describe("analyser cache snapshots", () => {
  it("should produce consistent results from cache", async () => {
    const projectName = "cache";
    const projectPath = path.resolve(
      process.cwd(),
      `../sample-project/${projectName}`,
    );

    const snapshotPath = path.join(
      process.cwd(),
      `./test/snapshots/${projectName}.json`,
    );
    const snapshotData = JSON.parse(fs.readFileSync(snapshotPath, "utf-8"));

    const result = await analyzeProject(projectPath);

    expect(normalize(result)).toEqual(normalize(snapshotData));
  });

  it("should match stored snapshot for cache-new", async () => {
    const projectName = "cache-new";
    const projectPath = path.resolve(
      process.cwd(),
      `../sample-project/${projectName}`,
    );

    const snapshotPath = path.join(
      process.cwd(),
      `./test/snapshots/${projectName}.json`,
    );
    const snapshotRaw = fs.readFileSync(snapshotPath, "utf-8");
    const snapshotData = JSON.parse(snapshotRaw);

    const cachePath = path.join(process.cwd(), `./test/snapshots/cache.json`);

    const result = await analyzeProject(projectPath, cachePath);

    expect(normalize(result)).toEqual(normalize(snapshotData));
  });

  it("should cache analysis results in SQLite", async () => {
    const projectName = "simple";
    const projectPath = path.resolve(
      process.cwd(),
      `../sample-project/${projectName}`,
    );

    const dbPath = path.join(
      process.cwd(),
      `./test/snapshots/${projectName}.sqlite`,
    );
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }

    await analyzeProject(projectPath, {
      sqlitePath: dbPath,
    });

    expect(fs.existsSync(dbPath)).toBe(true);

    const db = new SqliteDB(dbPath, { readonly: true });
    const files = db.db.prepare("SELECT * FROM files").all();
    expect(files.length).toBeGreaterThan(0);

    const entities = db.db.prepare("SELECT * FROM entities").all();
    expect(entities.length).toBeGreaterThan(0);

    db.close();

    // Second run should use cache
    const startAt = performance.now();
    await analyzeProject(projectPath, {
      sqlitePath: dbPath,
    });
    const duration = performance.now() - startAt;

    // This is not a strong guarantee but cache should be faster
    expect(duration).toBeLessThan(1000);
  }, 20000);
});
