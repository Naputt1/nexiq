import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteDB } from "./sqlite.ts";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { analyzeProject } from "../lib.ts";

describe("SqliteDB Recovery", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexiq-sqlite-test-"));
    dbPath = path.join(tmpDir, "test.sqlite");
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  });

  it("should create a new database file", () => {
    const db = new SqliteDB(dbPath);
    expect(fs.existsSync(dbPath)).toBe(true);
    db.close();
  });

  it("should recover from a corrupted database file", () => {
    // 1. Create a "corrupted" file (just some random bytes)
    fs.writeFileSync(dbPath, "this is not a sqlite database");

    // 2. Opening it should not throw and should recreate the DB
    const db = new SqliteDB(dbPath);
    expect(fs.existsSync(dbPath)).toBe(true);

    // Verify it's a valid DB now by doing a simple operation
    const result = db.db.prepare("SELECT 1 as val").get() as { val: number };
    expect(result.val).toBe(1);

    db.close();
  });

  it("should recover from corrupted -shm and -wal files", () => {
    // 1. Create a valid DB first
    {
      const db = new SqliteDB(dbPath);
      db.db.exec("CREATE TABLE test (id INTEGER)");
      db.close();
    }

    // 2. Corrupt the -shm and -wal files (if they exist, or just create them)
    fs.writeFileSync(`${dbPath}-shm`, "corrupted shm");
    fs.writeFileSync(`${dbPath}-wal`, "corrupted wal");

    // 3. Opening it should recover
    const db = new SqliteDB(dbPath);
    const result = db.db.prepare("SELECT 1 as val").get() as { val: number };
    expect(result.val).toBe(1);
    db.close();
  });

  it("should throw error if readonly and file is missing", () => {
    expect(() => new SqliteDB(dbPath, { readonly: true })).toThrow();
  });

  it("persists block scopes, function scope bounds, and props for graph consumers", async () => {
    const projectDir = path.join(tmpDir, "project");
    fs.mkdirSync(path.join(projectDir, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "package.json"),
      JSON.stringify({ name: "sqlite-graph", version: "1.0.0" }),
    );
    fs.writeFileSync(
      path.join(projectDir, "src", "App.tsx"),
      `
        import { memo, useEffect } from "react";

        type Props = { label: string };

        export const App = memo(function AppInner(props: Props) {
          useEffect(() => {
            for (let i = 0; i < 1; i++) {
              const value = props.label + i;
              console.log(value);
            }
          }, [props.label]);

          return <div>{props.label}</div>;
        });
      `,
    );

    await analyzeProject(projectDir, {
      monorepo: false,
      sqlitePath: dbPath,
      fileWorkerThreads: 1,
    });

    const db = new SqliteDB(dbPath, { readonly: true });

    const props = db.db
      .prepare(
        "SELECT kind, name FROM entities WHERE kind = 'prop' ORDER BY name",
      )
      .all() as Array<{ kind: string; name: string }>;
    expect(props).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "props" })]),
    );

    const functionScope = db.db
      .prepare(
        "SELECT data_json FROM scopes WHERE entity_id IN (SELECT id FROM entities WHERE name = 'App' LIMIT 1)",
      )
      .get() as { data_json: string | null } | undefined;
    expect(functionScope?.data_json).toBeTruthy();

    const blockScopes = db.db
      .prepare(
        "SELECT data_json FROM scopes WHERE entity_id IS NULL AND kind = 'block'",
      )
      .all() as Array<{ data_json: string | null }>;
    expect(blockScopes.length).toBeGreaterThan(0);

    db.close();
  });
});
