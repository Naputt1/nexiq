import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { analyzeProject } from "./index.ts";
import { SqliteDB } from "./db/sqlite.ts";

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

    fs.writeFileSync(
      appPath,
      "export default function App(){ return <div>ok</div>; }",
    );
    await analyzeProject(projectDir, {
      sqlitePath,
      fileWorkerThreads: 1,
    });

    fs.writeFileSync(
      appPath,
      "export default function App(){ return <div>{</div>; }",
    );
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

    const graph = await analyzeProject(rootDir, {
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
    const packageExports = centralDb
      .prepare("SELECT * FROM package_export_index")
      .all() as { package_id: string; export_name: string }[];
    const deferredImports = centralDb
      .prepare("SELECT * FROM deferred_external_imports")
      .all() as { package_id: string; source_module: string }[];
    const packageRelations = centralDb
      .prepare("SELECT * FROM package_relations")
      .all() as {
      from_package_id: string;
      to_package_id: string;
      source_file_path: string;
      target_file_path: string;
    }[];
    centralDb.close();

    expect(workspacePackages).toHaveLength(2);
    expect(packageExports.some((row) => row.export_name === "Shared")).toBe(
      true,
    );
    expect(
      deferredImports.some((row) => row.source_module === "@workspace/pkg-b"),
    ).toBe(true);
    expect(packageRelations).toHaveLength(1);
    expect(packageRelations[0]?.from_package_id).toContain("@workspace/pkg-a");
    expect(packageRelations[0]?.to_package_id).toContain("@workspace/pkg-b");
    expect(packageRelations[0]?.source_file_path).toBe("/src/index.tsx");
    expect(packageRelations[0]?.target_file_path).toBe("/src/index.tsx");
    expect(fs.existsSync(packageDbDir)).toBe(true);
    expect(fs.readdirSync(packageDbDir).length).toBeGreaterThanOrEqual(2);
    expect(graph.edges.some((edge) => edge.label === "import")).toBe(true);
  });

  it("resolves default imports from workspace package exports", async () => {
    const rootDir = createTempDir("nexiq-monorepo-default-");
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
      "export default function Shared(){ return <div>shared</div>; }",
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
      "import Shared from '@workspace/pkg-b'; export const App = () => <Shared />;",
    );

    const graph = await analyzeProject(rootDir, {
      monorepo: true,
      centralSqlitePath: centralDbPath,
      fileWorkerThreads: 1,
      packageConcurrency: 1,
    });

    const centralDb = new Database(centralDbPath, { readonly: true });
    const relations = centralDb
      .prepare("SELECT * FROM package_relations")
      .all() as { target_symbol: string }[];
    const errors = centralDb
      .prepare("SELECT * FROM cross_package_resolve_errors")
      .all() as unknown[];
    centralDb.close();

    expect(relations).toHaveLength(1);
    expect(relations[0]?.target_symbol).not.toBe("");
    expect(errors).toHaveLength(0);
    expect(graph.edges.some((edge) => edge.label === "import")).toBe(true);
  });

  it("records cross-package resolve errors for missing exports without creating fake edges", async () => {
    const rootDir = createTempDir("nexiq-monorepo-missing-export-");
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
      "export const Existing = () => <div>shared</div>;",
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
      "import { Missing } from '@workspace/pkg-b'; export const App = () => <Missing />;",
    );

    const graph = await analyzeProject(rootDir, {
      monorepo: true,
      centralSqlitePath: centralDbPath,
      fileWorkerThreads: 1,
      packageConcurrency: 1,
    });

    const centralDb = new Database(centralDbPath, { readonly: true });
    const relations = centralDb
      .prepare("SELECT * FROM package_relations")
      .all() as unknown[];
    const errors = centralDb
      .prepare("SELECT * FROM cross_package_resolve_errors")
      .all() as { source_module: string; message: string }[];
    centralDb.close();

    expect(relations).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.source_module).toBe("@workspace/pkg-b");
    expect(errors[0]?.message).toContain("No matching export");
    expect(graph.edges.some((edge) => edge.label === "import")).toBe(false);
    expect(
      graph.resolve.some(
        (task) =>
          task.type === "crossPackageImport" &&
          "source" in task &&
          task.source === "@workspace/pkg-b",
      ),
    ).toBe(true);
  });

  it("merges monorepo files with workspace-qualified paths and collision-free ids", async () => {
    const rootDir = createTempDir("nexiq-monorepo-canonical-");
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
      "export const SharedB = () => <div>b</div>;",
    );

    writeJson(path.join(rootDir, "packages", "pkg-c", "package.json"), {
      name: "@workspace/pkg-c",
      version: "1.0.0",
    });
    fs.mkdirSync(path.join(rootDir, "packages", "pkg-c", "src"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(rootDir, "packages", "pkg-c", "src", "index.tsx"),
      "export const SharedC = () => <div>c</div>;",
    );

    writeJson(path.join(rootDir, "packages", "pkg-a", "package.json"), {
      name: "@workspace/pkg-a",
      version: "1.0.0",
      dependencies: {
        "@workspace/pkg-b": "1.0.0",
        "@workspace/pkg-c": "1.0.0",
      },
    });
    fs.mkdirSync(path.join(rootDir, "packages", "pkg-a", "src"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(rootDir, "packages", "pkg-a", "src", "index.tsx"),
      [
        "import { SharedB } from '@workspace/pkg-b';",
        "import { SharedC } from '@workspace/pkg-c';",
        "export const App = () => <><SharedB /><SharedC /></>;",
      ].join(" "),
    );

    const graph = await analyzeProject(rootDir, {
      monorepo: true,
      centralSqlitePath: centralDbPath,
      fileWorkerThreads: 1,
      packageConcurrency: 1,
    });

    expect(Object.keys(graph.files).sort()).toEqual([
      "/packages/pkg-a/src/index.tsx",
      "/packages/pkg-b/src/index.tsx",
      "/packages/pkg-c/src/index.tsx",
    ]);
    expect(graph.files["/packages/pkg-a/src/index.tsx"]?.path).toBe(
      "/packages/pkg-a/src/index.tsx",
    );
    expect(graph.files["/packages/pkg-b/src/index.tsx"]?.path).toBe(
      "/packages/pkg-b/src/index.tsx",
    );
    expect(graph.files["/packages/pkg-c/src/index.tsx"]?.path).toBe(
      "/packages/pkg-c/src/index.tsx",
    );

    const exportB =
      graph.files["/packages/pkg-b/src/index.tsx"]?.export.SharedB?.id;
    const exportC =
      graph.files["/packages/pkg-c/src/index.tsx"]?.export.SharedC?.id;
    expect(exportB).toBeDefined();
    expect(exportC).toBeDefined();
    expect(exportB).not.toBe(exportC);

    const importEdges = graph.edges.filter((edge) => edge.label === "import");
    expect(importEdges).toHaveLength(2);
    expect(importEdges.some((edge) => edge.from === exportB)).toBe(true);
    expect(importEdges.some((edge) => edge.from === exportC)).toBe(true);
    expect(
      importEdges.every(
        (edge) =>
          edge.to.includes("@workspace/pkg-a") &&
          edge.from.includes("workspace:"),
      ),
    ).toBe(true);
  });

  it("stores package relations per workspace run without stale current-run rows", async () => {
    const rootDir = createTempDir("nexiq-monorepo-stale-relations-");
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
    const appPath = path.join(rootDir, "packages", "pkg-a", "src", "index.tsx");
    fs.writeFileSync(
      appPath,
      "import { Shared } from '@workspace/pkg-b'; export const App = () => <Shared />;",
    );

    await analyzeProject(rootDir, {
      monorepo: true,
      centralSqlitePath: centralDbPath,
      fileWorkerThreads: 1,
      packageConcurrency: 1,
    });

    fs.writeFileSync(appPath, "export const App = () => <div>local</div>;");

    await analyzeProject(rootDir, {
      monorepo: true,
      centralSqlitePath: centralDbPath,
      fileWorkerThreads: 1,
      packageConcurrency: 1,
    });

    const centralDb = new Database(centralDbPath, { readonly: true });
    const runs = centralDb
      .prepare("SELECT id FROM workspace_runs ORDER BY started_at ASC")
      .all() as { id: string }[];
    const firstRunRelations = centralDb
      .prepare("SELECT * FROM package_relations WHERE run_id = ?")
      .all(runs[0]?.id) as unknown[];
    const secondRunRelations = centralDb
      .prepare("SELECT * FROM package_relations WHERE run_id = ?")
      .all(runs[1]?.id) as unknown[];
    centralDb.close();

    expect(runs).toHaveLength(2);
    expect(firstRunRelations).toHaveLength(1);
    expect(secondRunRelations).toHaveLength(0);
  });

  it("stitches cross-package render edges to resolved exported components", async () => {
    const rootDir = createTempDir("nexiq-monorepo-render-stitch-");

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

    const graph = await analyzeProject(rootDir, {
      monorepo: true,
      fileWorkerThreads: 1,
      packageConcurrency: 1,
    });

    const sharedExportId =
      graph.files["/packages/pkg-b/src/index.tsx"]?.export.Shared?.id;
    const appComponentId = Object.values(
      graph.files["/packages/pkg-a/src/index.tsx"]?.var || {},
    ).find(
      (value) =>
        value.kind === "component" &&
        value.name.type === "identifier" &&
        value.name.name === "App",
    )?.id;

    expect(sharedExportId).toBeDefined();
    expect(appComponentId).toBeDefined();
    expect(
      graph.edges.some(
        (edge) =>
          edge.label === "render" &&
          edge.from === sharedExportId &&
          edge.to === appComponentId,
      ),
    ).toBe(true);
  });

  it("stitches cross-package prop type refs to resolved exported types", async () => {
    const rootDir = createTempDir("nexiq-monorepo-prop-type-stitch-");
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
      path.join(rootDir, "packages", "pkg-b", "src", "index.ts"),
      "export interface SharedProps { value: string }",
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
      [
        "import type { SharedProps } from '@workspace/pkg-b';",
        "export const App: React.FC<SharedProps> = (props) => {",
        "  return <div>{props.value}</div>;",
        "};",
      ].join(" "),
    );

    const graph = await analyzeProject(rootDir, {
      monorepo: true,
      centralSqlitePath: centralDbPath,
      fileWorkerThreads: 1,
      packageConcurrency: 1,
    });

    const sharedPropsExportId =
      graph.files["/packages/pkg-b/src/index.ts"]?.export.SharedProps?.id;
    const appComponent = Object.values(
      graph.files["/packages/pkg-a/src/index.tsx"]?.var || {},
    ).find(
      (value) =>
        value.kind === "component" &&
        value.name.type === "identifier" &&
        value.name.name === "App",
    );

    expect(sharedPropsExportId).toBeDefined();
    expect(appComponent).toBeDefined();
    expect(
      appComponent && "propType" in appComponent
        ? appComponent.propType
        : undefined,
    ).toMatchObject({
      type: "ref",
      refType: "named",
      name: sharedPropsExportId,
      resolvedId: sharedPropsExportId,
    });

    const packageDbDir = path.join(rootDir, ".nexiq", "packages");
    const packageDbPath = fs
      .readdirSync(packageDbDir)
      .map((name) => path.join(packageDbDir, name))
      .find((name) => name.includes("pkg-a"));
    const packageDb = new Database(packageDbPath!, { readonly: true });
    const resolveErrors = packageDb
      .prepare(
        "SELECT * FROM resolve_errors WHERE relation_kind IN ('tsType', 'comPropsTsType')",
      )
      .all() as unknown[];
    packageDb.close();
    expect(resolveErrors).toHaveLength(0);
  });

  it("stitches cross-package nested declared type refs to resolved exported types", async () => {
    const rootDir = createTempDir("nexiq-monorepo-declared-type-stitch-");

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
      path.join(rootDir, "packages", "pkg-b", "src", "index.ts"),
      "export interface SharedType { value: string }",
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
      path.join(rootDir, "packages", "pkg-a", "src", "index.ts"),
      [
        "import type { SharedType } from '@workspace/pkg-b';",
        "export type Wrapper = {",
        "  item: SharedType;",
        "};",
      ].join(" "),
    );

    const graph = await analyzeProject(rootDir, {
      monorepo: true,
      fileWorkerThreads: 1,
      packageConcurrency: 1,
    });

    const sharedTypeExportId =
      graph.files["/packages/pkg-b/src/index.ts"]?.export.SharedType?.id;
    const wrapperType = Object.values(
      graph.files["/packages/pkg-a/src/index.ts"]?.tsTypes || {},
    ).find(
      (value) =>
        value.type === "type" &&
        value.name.type === "identifier" &&
        value.name.name === "Wrapper",
    );

    expect(sharedTypeExportId).toBeDefined();
    expect(wrapperType).toBeDefined();
    expect(JSON.stringify(wrapperType)).toContain(sharedTypeExportId);
  });

  it("stitches cross-package namespace-qualified type refs to resolved exported types", async () => {
    const rootDir = createTempDir("nexiq-monorepo-namespace-type-stitch-");
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
      path.join(rootDir, "packages", "pkg-b", "src", "index.ts"),
      "export interface SharedType { value: string }",
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
      path.join(rootDir, "packages", "pkg-a", "src", "index.ts"),
      [
        "import type * as Types from '@workspace/pkg-b';",
        "export type Wrapper = Types.SharedType;",
      ].join(" "),
    );

    const graph = await analyzeProject(rootDir, {
      monorepo: true,
      centralSqlitePath: centralDbPath,
      fileWorkerThreads: 1,
      packageConcurrency: 1,
    });

    const sharedTypeExportId =
      graph.files["/packages/pkg-b/src/index.ts"]?.export.SharedType?.id;
    const wrapperType = Object.values(
      graph.files["/packages/pkg-a/src/index.ts"]?.tsTypes || {},
    ).find(
      (value) =>
        value.type === "type" &&
        value.name.type === "identifier" &&
        value.name.name === "Wrapper",
    );

    expect(sharedTypeExportId).toBeDefined();
    expect(JSON.stringify(wrapperType)).toContain(sharedTypeExportId);

    const packageDbDir = path.join(rootDir, ".nexiq", "packages");
    const packageDbPath = fs
      .readdirSync(packageDbDir)
      .map((name) => path.join(packageDbDir, name))
      .find((name) => name.includes("pkg-a"));
    const packageDb = new Database(packageDbPath!, { readonly: true });
    const resolveErrors = packageDb
      .prepare("SELECT * FROM resolve_errors WHERE relation_kind = 'tsType'")
      .all() as unknown[];
    packageDb.close();
    expect(resolveErrors).toHaveLength(0);
  });

  it("records unresolved namespace-qualified type refs through central resolve only", async () => {
    const rootDir = createTempDir("nexiq-monorepo-namespace-missing-type-");
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
      path.join(rootDir, "packages", "pkg-b", "src", "index.ts"),
      "export interface ExistingType { value: string }",
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
      path.join(rootDir, "packages", "pkg-a", "src", "index.ts"),
      [
        "import type * as Types from '@workspace/pkg-b';",
        "export type Wrapper = Types.MissingType;",
      ].join(" "),
    );

    const graph = await analyzeProject(rootDir, {
      monorepo: true,
      centralSqlitePath: centralDbPath,
      fileWorkerThreads: 1,
      packageConcurrency: 1,
    });

    const wrapperType = Object.values(
      graph.files["/packages/pkg-a/src/index.ts"]?.tsTypes || {},
    ).find(
      (value) =>
        value.type === "type" &&
        value.name.type === "identifier" &&
        value.name.name === "Wrapper",
    );
    expect(JSON.stringify(wrapperType)).not.toContain("/packages/pkg-b/");

    const centralDb = new Database(centralDbPath, { readonly: true });
    const errors = centralDb
      .prepare("SELECT * FROM cross_package_resolve_errors")
      .all() as { source_name: string; source_module: string }[];
    centralDb.close();
    expect(
      graph.resolve.some(
        (task) =>
          task.type === "crossPackageImport" &&
          "localName" in task &&
          task.localName === "MissingType",
      ),
    ).toBe(true);
    expect(errors.some((error) => error.source_name === "MissingType")).toBe(
      true,
    );

    const packageDbDir = path.join(rootDir, ".nexiq", "packages");
    const packageDbPath = fs
      .readdirSync(packageDbDir)
      .map((name) => path.join(packageDbDir, name))
      .find((name) => name.includes("pkg-a"));
    const packageDb = new Database(packageDbPath!, { readonly: true });
    const resolveErrors = packageDb
      .prepare("SELECT * FROM resolve_errors WHERE relation_kind = 'tsType'")
      .all() as unknown[];
    packageDb.close();
    expect(resolveErrors).toHaveLength(0);
  });

  it("stitches direct import-type refs to resolved exported types", async () => {
    const rootDir = createTempDir("nexiq-monorepo-import-type-stitch-");

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
      path.join(rootDir, "packages", "pkg-b", "src", "index.ts"),
      "export interface SharedType { value: string }",
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
      path.join(rootDir, "packages", "pkg-a", "src", "index.ts"),
      'export type Wrapper = import("@workspace/pkg-b").SharedType;',
    );

    const graph = await analyzeProject(rootDir, {
      monorepo: true,
      fileWorkerThreads: 1,
      packageConcurrency: 1,
    });

    const sharedTypeExportId =
      graph.files["/packages/pkg-b/src/index.ts"]?.export.SharedType?.id;
    const wrapperType = Object.values(
      graph.files["/packages/pkg-a/src/index.ts"]?.tsTypes || {},
    ).find(
      (value) =>
        value.type === "type" &&
        value.name.type === "identifier" &&
        value.name.name === "Wrapper",
    );

    expect(sharedTypeExportId).toBeDefined();
    expect(JSON.stringify(wrapperType)).toContain(sharedTypeExportId);
  });

  it("stitches typeof import() refs to resolved exported values", async () => {
    const rootDir = createTempDir("nexiq-monorepo-typeof-import-stitch-");

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
      path.join(rootDir, "packages", "pkg-b", "src", "index.ts"),
      "export function useShared(){ return { value: 1 }; }",
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
      path.join(rootDir, "packages", "pkg-a", "src", "index.ts"),
      'export type SharedHook = typeof import("@workspace/pkg-b").useShared;',
    );

    const graph = await analyzeProject(rootDir, {
      monorepo: true,
      fileWorkerThreads: 1,
      packageConcurrency: 1,
    });

    const hookExportId =
      graph.files["/packages/pkg-b/src/index.ts"]?.export.useShared?.id;
    const sharedHookType = Object.values(
      graph.files["/packages/pkg-a/src/index.ts"]?.tsTypes || {},
    ).find(
      (value) =>
        value.type === "type" &&
        value.name.type === "identifier" &&
        value.name.name === "SharedHook",
    );

    expect(hookExportId).toBeDefined();
    expect(JSON.stringify(sharedHookType)).toContain(hookExportId);
  });

  it("records unresolved workspace type imports without package-local type resolve errors", async () => {
    const rootDir = createTempDir("nexiq-monorepo-missing-type-export-");
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
      path.join(rootDir, "packages", "pkg-b", "src", "index.ts"),
      "export interface ExistingType { value: string }",
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
      [
        "import type { MissingType } from '@workspace/pkg-b';",
        "export const App: React.FC<MissingType> = (props) => {",
        "  return <div>{String(props)}</div>;",
        "};",
      ].join(" "),
    );

    const graph = await analyzeProject(rootDir, {
      monorepo: true,
      centralSqlitePath: centralDbPath,
      fileWorkerThreads: 1,
      packageConcurrency: 1,
    });

    const appComponent = Object.values(
      graph.files["/packages/pkg-a/src/index.tsx"]?.var || {},
    ).find(
      (value) =>
        value.kind === "component" &&
        value.name.type === "identifier" &&
        value.name.name === "App",
    );
    expect(
      appComponent && "propType" in appComponent
        ? appComponent.propType
        : undefined,
    ).toMatchObject({
      type: "ref",
      refType: "named",
      unresolvedWorkspace: true,
    });

    const centralDb = new Database(centralDbPath, { readonly: true });
    const errors = centralDb
      .prepare("SELECT * FROM cross_package_resolve_errors")
      .all() as { source_name: string; source_module: string }[];
    centralDb.close();

    expect(
      graph.resolve.some(
        (task) =>
          task.type === "crossPackageImport" &&
          "localName" in task &&
          task.localName === "MissingType",
      ),
    ).toBe(true);
    expect(errors.some((error) => error.source_name === "MissingType")).toBe(
      true,
    );
    expect(JSON.stringify(appComponent)).not.toContain("/packages/pkg-b/");

    const packageDbDir = path.join(rootDir, ".nexiq", "packages");
    const packageDbPath = fs
      .readdirSync(packageDbDir)
      .map((name) => path.join(packageDbDir, name))
      .find((name) => name.includes("pkg-a"));
    const packageDb = new Database(packageDbPath!, { readonly: true });
    const resolveErrors = packageDb
      .prepare(
        "SELECT * FROM resolve_errors WHERE relation_kind IN ('tsType', 'comPropsTsType')",
      )
      .all() as unknown[];
    packageDb.close();
    expect(resolveErrors).toHaveLength(0);
  });

  it("stitches cross-package hook edges to resolved exported hooks", async () => {
    const rootDir = createTempDir("nexiq-monorepo-hook-stitch-");

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
      "export function useShared(){ return { value: 1 }; }",
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
      [
        "import { useShared } from '@workspace/pkg-b';",
        "export const App = () => {",
        "  const data = useShared();",
        "  return <div>{data.value}</div>;",
        "};",
      ].join(" "),
    );

    const graph = await analyzeProject(rootDir, {
      monorepo: true,
      fileWorkerThreads: 1,
      packageConcurrency: 1,
    });

    const hookExportId =
      graph.files["/packages/pkg-b/src/index.tsx"]?.export.useShared?.id;

    expect(hookExportId).toBeDefined();
    expect(
      graph.edges.some(
        (edge) =>
          edge.label === "hook" &&
          edge.to === hookExportId &&
          edge.from.includes("callhook:useShared"),
      ),
    ).toBe(true);
  });

  it("records unresolved workspace hook imports without fake hook edges or retry loops", async () => {
    const rootDir = createTempDir("nexiq-monorepo-missing-hook-export-");
    const centralDbPath = path.join(rootDir, ".nexiq", "workspace.sqlite");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

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
      [
        "import { useShared } from '@workspace/pkg-b';",
        "export const App = () => {",
        "  const data = useShared();",
        "  return <div>{String(data)}</div>;",
        "};",
      ].join(" "),
    );

    try {
      const graph = await analyzeProject(rootDir, {
        monorepo: true,
        centralSqlitePath: centralDbPath,
        fileWorkerThreads: 1,
        packageConcurrency: 1,
      });

      const centralDb = new Database(centralDbPath, { readonly: true });
      const errors = centralDb
        .prepare("SELECT * FROM cross_package_resolve_errors")
        .all() as { source_name: string; source_module: string }[];
      const packageDbDir = path.join(rootDir, ".nexiq", "packages");
      const packageDbPath = fs
        .readdirSync(packageDbDir)
        .map((name) => path.join(packageDbDir, name))
        .find((name) => name.includes("pkg-a"));
      centralDb.close();

      expect(
        graph.edges.some(
          (edge) =>
            edge.label === "hook" &&
            edge.from.includes("callhook:useShared") &&
            edge.to.includes("/packages/pkg-b/"),
        ),
      ).toBe(false);
      expect(
        graph.resolve.some(
          (task) =>
            task.type === "crossPackageImport" &&
            "localName" in task &&
            task.localName === "useShared",
        ),
      ).toBe(true);
      expect(errors.some((error) => error.source_name === "useShared")).toBe(
        true,
      );

      const packageDb = new Database(packageDbPath!, { readonly: true });
      const resolveErrors = packageDb
        .prepare(
          "SELECT * FROM resolve_errors WHERE relation_kind = 'comResolveCallHook'",
        )
        .all() as unknown[];
      packageDb.close();
      expect(resolveErrors).toHaveLength(0);
      expect(warnSpy).not.toHaveBeenCalledWith(
        "Resolution interrupted: suspected infinite loop or deep dependency chain in ComponentDB.resolve",
        expect.anything(),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});
