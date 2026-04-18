import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteDB } from "./sqlite.ts";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

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
    } catch (e) {
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
});
