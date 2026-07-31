import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
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

  it("should detect modified file content on cache re-run", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cache-mod-"));
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir);
    const appFile = path.join(srcDir, "App.tsx");
    const dbPath = path.join(tmpDir, "analysis.sqlite");

    fs.writeFileSync(appFile, "export const App = () => <div>one</div>;");
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "cache-mod" }),
    );

    try {
      await analyzeProject(tmpDir, { sqlitePath: dbPath });

      const dbFirst = new SqliteDB(dbPath, { readonly: true });
      const hashBefore = dbFirst.db
        .prepare("SELECT hash FROM files WHERE path = ?")
        .get("/src/App.tsx") as { hash: string } | undefined;
      dbFirst.close();

      // Modify the file (same size not guaranteed; content definitely differs).
      fs.writeFileSync(appFile, "export const App = () => <div>two</div>;");

      await analyzeProject(tmpDir, { sqlitePath: dbPath });

      const db = new SqliteDB(dbPath, { readonly: true });
      const hashAfter = db.db
        .prepare("SELECT hash FROM files WHERE path = ?")
        .get("/src/App.tsx") as { hash: string } | undefined;
      db.close();

      // The content hash must change so the cache serves fresh results.
      expect(hashBefore).toBeDefined();
      expect(hashAfter).toBeDefined();
      expect(hashAfter!.hash).not.toBe(hashBefore!.hash);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 20000);

  it("should purge deleted files from cache", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cache-del-"));
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir);
    const extraFile = path.join(srcDir, "Extra.tsx");
    const dbPath = path.join(tmpDir, "analysis.sqlite");

    fs.writeFileSync(path.join(srcDir, "App.tsx"), "export const App = () => <div />;");
    fs.writeFileSync(extraFile, "export const Extra = () => <span />;");
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "cache-del" }),
    );

    try {
      const graph = await analyzeProject(tmpDir, { sqlitePath: dbPath });
      const dbx = new SqliteDB(dbPath, { readonly: true });
      console.log("DBG tables:", dbx.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: any) => r.name));
      dbx.close();

      let db = new SqliteDB(dbPath, { readonly: true });
      const before = db.db.prepare("SELECT path FROM files").all() as Array<{
        path: string;
      }>;
      console.log("DBG files:", JSON.stringify(before));
      db.close();
      expect(before.some((r) => r.path.includes("Extra"))).toBe(true);

      // Delete the extra file and re-analyze — its rows should be purged.
      fs.rmSync(extraFile);

      await analyzeProject(tmpDir, { sqlitePath: dbPath });

      db = new SqliteDB(dbPath, { readonly: true });
      const after = db.db.prepare("SELECT path FROM files").all() as Array<{
        path: string;
      }>;
      db.close();

      expect(after.some((r) => r.path.includes("Extra"))).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 20000);

  it("should not resurrect stale relations after a file is changed", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cache-rel-"));
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir);
    const dbPath = path.join(tmpDir, "analysis.sqlite");

    const withUsage = `
      const used = 42;
      export const App = () => <div>{used}</div>;
    `;
    const withoutUsage = "export const App = () => <div>no usage</div>;";

    fs.writeFileSync(path.join(srcDir, "App.tsx"), withUsage);
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "cache-rel" }),
    );

    try {
      await analyzeProject(tmpDir, { sqlitePath: dbPath });

      const db = new SqliteDB(dbPath, { readonly: true });
      const before = db.db.prepare("SELECT COUNT(*) AS n FROM relations").get() as {
        n: number;
      };
      db.close();
      expect(before.n).toBeGreaterThan(0);

      // Remove the usage and re-analyze. The stale relations must be purged.
      fs.writeFileSync(path.join(srcDir, "App.tsx"), withoutUsage);
      await analyzeProject(tmpDir, { sqlitePath: dbPath });

      const db2 = new SqliteDB(dbPath, { readonly: true });
      const after = db2.db
        .prepare("SELECT file_id, kind, data_json FROM relations")
        .all() as Array<{ file_id: number | null; kind: string; data_json: string | null }>;
      db2.close();

      // Stale per-file usage relations must be purged. Only graph edges
      // (file_id null, no data_json) may remain.
      expect(after.every((r) => r.file_id === null && !r.data_json)).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 20000);
});
