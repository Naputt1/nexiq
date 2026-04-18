import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ProjectManager } from "./projectManager.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// We need to use real FS for these tests because we are testing corruption
// But ProjectManager in projectManager.test.ts uses vi.mock("node:fs")
// So we must be careful.

describe("ProjectManager Recovery (Integration)", () => {
  let tmpDir: string;
  let projectPath: string;
  let projectManager: ProjectManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexiq-server-test-"));
    projectPath = path.join(tmpDir, "project");
    fs.mkdirSync(projectPath);
    fs.writeFileSync(path.join(projectPath, "package.json"), JSON.stringify({ name: "test-project" }));
    fs.mkdirSync(path.join(projectPath, "src"));
    fs.writeFileSync(path.join(projectPath, "src", "index.tsx"), "export const App = () => <div>Hello</div>;");
    
    projectManager = new ProjectManager();
  });

  afterEach(async () => {
    await projectManager.closeAll();
    try {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch (e) {
      // ignore
    }
  });

  it("should recover from a missing database file while project is cached", async () => {
    // 1. Open project
    const info = await projectManager.openProject(projectPath);
    expect(fs.existsSync(info.sqlitePath)).toBe(true);

    // 2. Delete the database file
    fs.unlinkSync(info.sqlitePath);
    expect(fs.existsSync(info.sqlitePath)).toBe(false);

    // 3. Open project again - should detect missing DB and re-initialize
    const info2 = await projectManager.openProject(projectPath);
    expect(fs.existsSync(info2.sqlitePath)).toBe(true);
    // The path should be the same
    expect(info2.sqlitePath).toBe(info.sqlitePath);
  });

  it("should recover from a corrupted database file while project is cached", async () => {
    // 1. Open project
    const info = await projectManager.openProject(projectPath);
    
    // 2. Corrupt the database file
    fs.writeFileSync(info.sqlitePath, "corrupted database");

    // 3. Open project again - should detect corruption and re-initialize
    const info2 = await projectManager.openProject(projectPath);
    expect(fs.existsSync(info2.sqlitePath)).toBe(true);
    
    // Verify it's a real DB now
    const result = info2.db!.db.prepare("SELECT 1 as val").get() as { val: number };
    expect(result.val).toBe(1);
  });

  it("should handle corrupted nexiq.config.json gracefully", async () => {
    const configPath = path.join(projectPath, "nexiq.config.json");
    fs.writeFileSync(configPath, "{ corrupted json: ");

    // Should not throw and proceed with defaults
    const info = await projectManager.openProject(projectPath);
    expect(info.graph).toBeDefined();
  });

  it("should handle corrupted cache file gracefully", async () => {
    const info = await projectManager.openProject(projectPath);
    const cacheFile = (projectManager as any).getProjectStoragePaths(projectPath).cacheFile;
    
    expect(fs.existsSync(cacheFile)).toBe(true);
    fs.writeFileSync(cacheFile, "{ corrupted cache: ");

    // Close and re-open to trigger cache load
    await projectManager.closeAll();
    projectManager = new ProjectManager();

    const info2 = await projectManager.openProject(projectPath);
    expect(info2.graph).toBeDefined();
    // It should have re-analyzed and fixed the cache file
    const cacheContent = fs.readFileSync(cacheFile, "utf-8");
    expect(() => JSON.parse(cacheContent)).not.toThrow();
  });
});
