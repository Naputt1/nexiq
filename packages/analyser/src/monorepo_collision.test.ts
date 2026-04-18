
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { analyzeProject } from "./index.ts";

function createTempDir(prefix: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJson(filePath: string, data: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

describe("monorepo collision handling", () => {
  it("uses root-relative paths to avoid collisions between packages", async () => {
    const rootDir = createTempDir("nexiq-monorepo-collision-");
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

    // Package A has src/index.tsx
    writeJson(path.join(rootDir, "packages", "pkg-a", "package.json"), {
      name: "@workspace/pkg-a",
      version: "1.0.0",
    });
    fs.mkdirSync(path.join(rootDir, "packages", "pkg-a", "src"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(rootDir, "packages", "pkg-a", "src", "index.tsx"),
      "export const ComponentA = () => <div>A</div>;",
    );

    // Package B also has src/index.tsx
    writeJson(path.join(rootDir, "packages", "pkg-b", "package.json"), {
      name: "@workspace/pkg-b",
      version: "1.0.0",
    });
    fs.mkdirSync(path.join(rootDir, "packages", "pkg-b", "src"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(rootDir, "packages", "pkg-b", "src", "index.tsx"),
      "export const ComponentB = () => <div>B</div>;",
    );

    const graph = await analyzeProject(rootDir, {
      monorepo: true,
      packageDbDir,
      centralSqlitePath: centralDbPath,
      fileWorkerThreads: 1,
      packageConcurrency: 1,
    });

    // Verify root-relative paths in the merged graph
    const filePaths = Object.keys(graph.files);
    expect(filePaths).toContain("/packages/pkg-a/src/index.tsx");
    expect(filePaths).toContain("/packages/pkg-b/src/index.tsx");
    expect(filePaths).not.toContain("/src/index.tsx");

    // Verify data in central DB
    const centralDb = new Database(centralDbPath, { readonly: true });

    // In our implementation, we updated getTaskData and the UI aggregation.
    // The CentralMaster already used root-relative paths for its merged output.
    // Let's verify if our fix in getTaskData works by mocking a TaskContext.
    const { getTaskData } = await import("../../extension-sdk/src/index.ts");
    const data = getTaskData({
      db: centralDb as any,
      projectRoot: rootDir,
      viewType: "component",
    });

    const filePathsInAggregated = data.files.map((f) => f.path);
    expect(filePathsInAggregated).toContain("/packages/pkg-a/src/index.tsx");
    expect(filePathsInAggregated).toContain("/packages/pkg-b/src/index.tsx");

    centralDb.close();
  });
});
