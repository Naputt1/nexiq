
import { describe, it, expect, afterEach } from "vitest";
import { runComponentTaskSqlite } from "../index.cjs";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function materializeSqliteBuffer(buffer: Buffer): any {
  const tempPath = path.resolve(
    __dirname,
    `./temp-res-${Math.random().toString(36).substring(7)}.sqlite`,
  );
  fs.writeFileSync(tempPath, buffer);
  const resDb = new Database(tempPath);

  const nodes = resDb
    .prepare(
      "SELECT id, name, type, combo_id as combo, color, radius, display_name as displayName FROM out_nodes",
    )
    .all();
  const combos = resDb
    .prepare(
      "SELECT id, name, type, parent_id as combo, color, radius, collapsed, display_name as displayName FROM out_combos",
    )
    .all();
  const edges = resDb.prepare("SELECT * FROM out_edges").all();
  const details = resDb.prepare("SELECT * FROM out_details").all();

  resDb.close();
  if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);

  return { nodes, combos, edges, details };
}

describe("Rust Component Task Monorepo", () => {
  const createdFiles: string[] = [];

  afterEach(() => {
    for (const f of createdFiles) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    createdFiles.length = 0;
  });

  function createPkgDb(id: string) {
    const dbPath = path.resolve(__dirname, `./pkg-${id}-${Math.random().toString(36).substring(7)}.sqlite`);
    createdFiles.push(dbPath);
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE packages (id TEXT PRIMARY KEY, name TEXT, version TEXT, path TEXT);
      CREATE TABLE files (id INTEGER PRIMARY KEY, path TEXT, package_id TEXT, hash TEXT, fingerprint TEXT, default_export TEXT, star_exports_json TEXT);
      CREATE TABLE entities (id TEXT PRIMARY KEY, scope_id TEXT, kind TEXT, name TEXT, type TEXT, line INTEGER, column INTEGER, end_line INTEGER, end_column INTEGER, declaration_kind TEXT, data_json TEXT);
      CREATE TABLE scopes (id TEXT PRIMARY KEY, file_id INTEGER, parent_id TEXT, kind TEXT, entity_id TEXT, data_json TEXT);
      CREATE TABLE symbols (id TEXT PRIMARY KEY, entity_id TEXT, scope_id TEXT, name TEXT, path TEXT, is_alias INTEGER, has_default INTEGER, data_json TEXT);
      CREATE TABLE renders (id TEXT PRIMARY KEY, file_id INTEGER, parent_entity_id TEXT, parent_render_id TEXT, tag TEXT, symbol_id TEXT, line INTEGER, column INTEGER, kind TEXT, data_json TEXT);
      CREATE TABLE relations (from_id TEXT, to_id TEXT, kind TEXT, line INTEGER, column INTEGER, data_json TEXT);
      CREATE TABLE exports (id TEXT PRIMARY KEY, scope_id TEXT, symbol_id TEXT, entity_id TEXT, name TEXT, is_default INTEGER);
    `);
    return { db, dbPath };
  }

  it("should aggregate data and handle collisions using root-relative paths", () => {
    const workspaceDbPath = path.resolve(__dirname, `./workspace-${Math.random().toString(36).substring(7)}.sqlite`);
    createdFiles.push(workspaceDbPath);
    const workspaceDb = new Database(workspaceDbPath);
    workspaceDb.exec(`
      CREATE TABLE workspace_packages (package_id TEXT PRIMARY KEY, name TEXT, version TEXT, path TEXT, db_path TEXT);
    `);

    const { db: pkgADb, dbPath: pkgADbPath } = createPkgDb("a");
    pkgADb.exec(`
      INSERT INTO packages VALUES ('pkg-a', '@workspace/pkg-a', '1.0.0', 'packages/pkg-a');
      INSERT INTO files (id, path, package_id, hash, fingerprint) VALUES (1, '/src/index.tsx', 'pkg-a', 'h1', 'f1');
      INSERT INTO entities (id, scope_id, kind, name, type) VALUES ('e-a', 's-a-module', 'component', 'CompA', 'function');
      INSERT INTO symbols (id, entity_id, scope_id, name) VALUES ('sym-a', 'e-a', 's-a-module', 'CompA');
      INSERT INTO scopes (id, file_id, parent_id, kind, entity_id) VALUES ('s-a-module', 1, NULL, 'module', NULL);
    `);
    pkgADb.close();

    const { db: pkgBDb, dbPath: pkgBDbPath } = createPkgDb("b");
    pkgBDb.exec(`
      INSERT INTO packages VALUES ('pkg-b', '@workspace/pkg-b', '1.0.0', 'packages/pkg-b');
      INSERT INTO files (id, path, package_id, hash, fingerprint) VALUES (1, '/src/index.tsx', 'pkg-b', 'h2', 'f2');
      INSERT INTO entities (id, scope_id, kind, name, type) VALUES ('e-b', 's-b-module', 'component', 'CompB', 'function');
      INSERT INTO symbols (id, entity_id, scope_id, name) VALUES ('sym-b', 'e-b', 's-b-module', 'CompB');
      INSERT INTO scopes (id, file_id, parent_id, kind, entity_id) VALUES ('s-b-module', 1, NULL, 'module', NULL);
    `);
    pkgBDb.close();

    workspaceDb.prepare("INSERT INTO workspace_packages VALUES (?, ?, ?, ?, ?)").run('pkg-a', '@workspace/pkg-a', '1.0.0', 'packages/pkg-a', pkgADbPath);
    workspaceDb.prepare("INSERT INTO workspace_packages VALUES (?, ?, ?, ?, ?)").run('pkg-b', '@workspace/pkg-b', '1.0.0', 'packages/pkg-b', pkgBDbPath);
    workspaceDb.close();

    const context = {
      projectRoot: __dirname,
      viewType: "component",
      cacheDbPath: workspaceDbPath,
    };

    const resultBuffer = runComponentTaskSqlite(context);
    const snapshot = materializeSqliteBuffer(resultBuffer as Buffer);

    // Verify both components are present
    const nodeA = snapshot.nodes.find((n: any) => n.name === "CompA");
    const nodeB = snapshot.nodes.find((n: any) => n.name === "CompB");
    expect(nodeA).toBeDefined();
    expect(nodeB).toBeDefined();

    // Verify root-relative paths in details
    const detailA = snapshot.details.find((d: any) => d.id === nodeA.id);
    const detailB = snapshot.details.find((d: any) => d.id === nodeB.id);
    expect(detailA.file_name).toBe("/packages/pkg-a/src/index.tsx");
    expect(detailB.file_name).toBe("/packages/pkg-b/src/index.tsx");
  });

  it("should resolve cross-package imports using package names in Rust", () => {
    const workspaceDbPath = path.resolve(__dirname, `./workspace-${Math.random().toString(36).substring(7)}.sqlite`);
    createdFiles.push(workspaceDbPath);
    const workspaceDb = new Database(workspaceDbPath);
    workspaceDb.exec(`
      CREATE TABLE workspace_packages (package_id TEXT PRIMARY KEY, name TEXT, version TEXT, path TEXT, db_path TEXT);
    `);

    const { db: pkgADb, dbPath: pkgADbPath } = createPkgDb("a");
    pkgADb.exec(`
      INSERT INTO packages VALUES ('pkg-a', '@workspace/pkg-a', '1.0.0', 'packages/pkg-a');
      INSERT INTO files (id, path, package_id, hash, fingerprint) VALUES (1, '/src/App.tsx', 'pkg-a', 'h1', 'f1');
      INSERT INTO entities (id, scope_id, kind, name, type) VALUES ('e-caller', 's-app-module', 'component', 'App', 'function');
      INSERT INTO symbols (id, entity_id, scope_id, name) VALUES ('sym-caller', 'e-caller', 's-app-module', 'App');
      
      -- Import of CompB from pkg-b
      INSERT INTO entities (id, scope_id, kind, name, type, data_json) 
      VALUES ('e-import', 's-app-module', 'import', 'CompB', 'data', '{"source":"@workspace/pkg-b","importedName":"CompB","type":"named"}');
      INSERT INTO symbols (id, entity_id, scope_id, name) VALUES ('sym-import', 'e-import', 's-app-module', 'CompB');
      
      INSERT INTO scopes (id, file_id, parent_id, kind, entity_id) VALUES ('s-app-module', 1, NULL, 'module', NULL);
      
      -- Relation in pkg-a pointing from App to the import
      INSERT INTO relations (from_id, to_id, kind) VALUES ('sym-caller', 'sym-import', 'usage-call');
    `);
    pkgADb.close();

    const { db: pkgBDb, dbPath: pkgBDbPath } = createPkgDb("b");
    pkgBDb.exec(`
      INSERT INTO packages VALUES ('pkg-b', '@workspace/pkg-b', '1.0.0', 'packages/pkg-b');
      INSERT INTO files (id, path, package_id, hash, fingerprint) VALUES (1, '/src/index.tsx', 'pkg-b', 'h2', 'f2');
      INSERT INTO entities (id, scope_id, kind, name, type) VALUES ('e-b', 's-b-module', 'component', 'CompB', 'function');
      INSERT INTO symbols (id, entity_id, scope_id, name) VALUES ('sym-b', 'e-b', 's-b-module', 'CompB');
      INSERT INTO scopes (id, file_id, parent_id, kind, entity_id) VALUES ('s-b-module', 1, NULL, 'module', NULL);
      INSERT INTO exports (id, scope_id, symbol_id, entity_id, name, is_default) VALUES ('exp-b', 's-b-module', 'sym-b', 'e-b', 'CompB', 0);
    `);
    pkgBDb.close();

    workspaceDb.prepare("INSERT INTO workspace_packages VALUES (?, ?, ?, ?, ?)").run('pkg-a', '@workspace/pkg-a', '1.0.0', 'packages/pkg-a', pkgADbPath);
    workspaceDb.prepare("INSERT INTO workspace_packages VALUES (?, ?, ?, ?, ?)").run('pkg-b', '@workspace/pkg-b', '1.0.0', 'packages/pkg-b', pkgBDbPath);
    workspaceDb.close();

    const context = {
      projectRoot: __dirname,
      viewType: "component",
      cacheDbPath: workspaceDbPath,
    };

    const resultBuffer = runComponentTaskSqlite(context);
    const snapshot = materializeSqliteBuffer(resultBuffer as Buffer);
    
    // In our Rust code, we prefixed IDs during aggregation
    const expectedCallerId = "workspace:pkg-a:workspace:pkg-a:sym-caller"; 
    // Wait, I should check how prefixing works in my Rust code.
    // prefix = format!("workspace:{}:", pkg_id);
    // INSERT ... SELECT prefix || id ...
    
    // If the original ID was already prefixed, it gets double prefixed!
    // This is why it's better to NOT have prefixed IDs in individual DBs.
    
    const usageEdge = snapshot.edges.find((e: any) => e.kind === "usage-call");
    expect(usageEdge).toBeDefined();
    // expected source: workspace:pkg-a:sym-caller
    // expected target: workspace:pkg-b:sym-b
    
    expect(usageEdge?.target).toContain("sym-b");
    expect(usageEdge?.target).toContain("workspace:pkg-b:");
  });
});
