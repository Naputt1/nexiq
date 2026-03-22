import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { analyzeProject } from "./index.js";
import { SqliteDB } from "./db/sqlite.js";

function createTempDir(prefix: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJson(filePath: string, data: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

describe("analyser orchestration", () => {
  it("stores parse failures for invalid files", async () => {
    const projectDir = createTempDir("nexiq-parse-error-");
    const sqlitePath = path.join(projectDir, "analysis.sqlite");

    writeJson(path.join(projectDir, "package.json"), {
      name: "parse-error-project",
      version: "1.0.0",
    });
    fs.mkdirSync(path.join(projectDir, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "src", "Broken.tsx"),
      "export const Broken = () => <div>{</div>;",
    );
    fs.writeFileSync(
      path.join(projectDir, "src", "Valid.tsx"),
      "export const Valid = () => <div>ok</div>;",
    );

    await analyzeProject(projectDir, {
      sqlitePath,
      fileWorkerThreads: 1,
    });

    const sqlite = new SqliteDB(sqlitePath);
    const errors = sqlite.db
      .prepare("SELECT * FROM file_analysis_errors")
      .all() as { file_path: string; stage: string }[];
    sqlite.close();

    expect(errors).toHaveLength(1);
    expect(errors[0]?.file_path).toBe("/src/Broken.tsx");
    expect(errors[0]?.stage).toBe("parse");
  });

  it("keeps the last good canonical file result when a rerun fails", async () => {
    const projectDir = createTempDir("nexiq-last-good-");
    const sqlitePath = path.join(projectDir, "analysis.sqlite");

    writeJson(path.join(projectDir, "package.json"), {
      name: "last-good-project",
      version: "1.0.0",
    });
    fs.mkdirSync(path.join(projectDir, "src"), { recursive: true });
    const appPath = path.join(projectDir, "src", "App.tsx");

    fs.writeFileSync(appPath, "export default function App(){ return <div>ok</div>; }");
    await analyzeProject(projectDir, {
      sqlitePath,
      fileWorkerThreads: 1,
    });

    fs.writeFileSync(appPath, "export default function App(){ return <div>{</div>; }");
    await analyzeProject(projectDir, {
      sqlitePath,
      fileWorkerThreads: 1,
    });

    const sqlite = new SqliteDB(sqlitePath);
    const cachedFile = sqlite.loadFileResults("/src/App.tsx");
    const errors = sqlite.db
      .prepare("SELECT * FROM file_analysis_errors WHERE file_path = ?")
      .all("/src/App.tsx") as { stage: string }[];
    sqlite.close();

    expect(cachedFile).toBeDefined();
    expect(cachedFile?.path).toBe("/src/App.tsx");
    expect(errors.some((error) => error.stage === "parse")).toBe(true);
  });

  it("creates package DBs and a central DB for monorepo analysis", async () => {
    const rootDir = createTempDir("nexiq-monorepo-");
    const packageDbDir = path.join(rootDir, ".nexiq", "packages");
    const centralDbPath = path.join(rootDir, ".nexiq", "workspace.sqlite");

    writeJson(path.join(rootDir, "package.json"), {
      name: "workspace-root",
      version: "1.0.0",
      private: true,
    });
    fs.writeFileSync(
      path.join(rootDir, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n",
    );

    writeJson(path.join(rootDir, "packages", "pkg-b", "package.json"), {
      name: "@workspace/pkg-b",
      version: "1.0.0",
    });
    fs.mkdirSync(path.join(rootDir, "packages", "pkg-b", "src"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(rootDir, "packages", "pkg-b", "src", "index.tsx"),
      "export const Shared = () => <div>shared</div>;",
    );

    writeJson(path.join(rootDir, "packages", "pkg-a", "package.json"), {
      name: "@workspace/pkg-a",
      version: "1.0.0",
      dependencies: {
        "@workspace/pkg-b": "1.0.0",
      },
    });
    fs.mkdirSync(path.join(rootDir, "packages", "pkg-a", "src"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(rootDir, "packages", "pkg-a", "src", "index.tsx"),
      "import { Shared } from '@workspace/pkg-b'; export const App = () => <Shared />;",
    );

    await analyzeProject(rootDir, {
      monorepo: true,
      packageDbDir,
      centralSqlitePath: centralDbPath,
      fileWorkerThreads: 1,
      packageConcurrency: 1,
    });

    const centralDb = new Database(centralDbPath, { readonly: true });
    const workspacePackages = centralDb
      .prepare("SELECT * FROM workspace_packages")
      .all() as { package_id: string }[];
    const packageRelations = centralDb
      .prepare("SELECT * FROM package_relations")
      .all() as { from_package_id: string; to_package_id: string }[];
    centralDb.close();

    expect(workspacePackages).toHaveLength(2);
    expect(packageRelations).toHaveLength(1);
    expect(packageRelations[0]?.from_package_id).toContain("@workspace/pkg-a");
    expect(packageRelations[0]?.to_package_id).toContain("@workspace/pkg-b");
    expect(fs.existsSync(packageDbDir)).toBe(true);
    expect(fs.readdirSync(packageDbDir).length).toBeGreaterThanOrEqual(2);
  });
});
