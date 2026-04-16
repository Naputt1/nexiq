import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runComponentTaskSqlite } from "../index.cjs";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { OutCombo, OutEdge, OutNode } from "@nexiq/extension-sdk";

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

describe("Rust Component Task", () => {
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    dbPath = path.resolve(
      __dirname,
      `./test-${Math.random().toString(36).substring(7)}.sqlite`,
    );
    db = new Database(dbPath);

    // Initialize Schema
    db.exec(`
            CREATE TABLE packages (id TEXT PRIMARY KEY, name TEXT, version TEXT, path TEXT);
            CREATE TABLE files (id INTEGER PRIMARY KEY, path TEXT, package_id TEXT, hash TEXT, fingerprint TEXT);
            CREATE TABLE entities (id TEXT PRIMARY KEY, scope_id TEXT, kind TEXT, name TEXT, type TEXT, line INTEGER, column INTEGER, data_json TEXT);
            CREATE TABLE scopes (id TEXT PRIMARY KEY, file_id INTEGER, parent_id TEXT, kind TEXT, entity_id TEXT);
            CREATE TABLE symbols (id TEXT PRIMARY KEY, entity_id TEXT, scope_id TEXT, name TEXT, path TEXT);
            CREATE TABLE renders (id TEXT PRIMARY KEY, file_id INTEGER, parent_entity_id TEXT, parent_render_id TEXT, symbol_id TEXT, tag TEXT, line INTEGER, column INTEGER, kind TEXT, data_json TEXT);
            CREATE TABLE relations (from_id TEXT, to_id TEXT, kind TEXT, data_json TEXT);
            CREATE TABLE exports (id TEXT PRIMARY KEY, scope_id TEXT, symbol_id TEXT, entity_id TEXT, name TEXT, is_default INTEGER);

            INSERT INTO packages (id, name, version, path) VALUES ('pkg-1', 'test-pkg', '1.0.0', '/root');
            INSERT INTO files (id, path, package_id, hash, fingerprint) VALUES (1, '/root/src/App.tsx', 'pkg-1', 'h1', 'f1');
            INSERT INTO scopes (id, file_id, parent_id, kind, entity_id) VALUES ('s-module', 1, NULL, 'module', NULL);
        `);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {}
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it("should correctly classify 'normal' variables as 'variable' type", () => {
    db.exec(`
            INSERT INTO entities (id, scope_id, kind, name, type) VALUES ('e-var', 's-module', 'normal', 'MY_VAR', 'data');
            INSERT INTO symbols (id, entity_id, scope_id, name) VALUES ('sym-var', 'e-var', 's-module', 'MY_VAR');
        `);

    const context = {
      projectRoot: "/root",
      viewType: "component",
      cacheDbPath: dbPath,
    };

    db.close();
    const resultBuffer = runComponentTaskSqlite(context);
    const snapshot = materializeSqliteBuffer(resultBuffer as Buffer);

    const node = snapshot.nodes.find((n: OutNode) => n.name === "MY_VAR");
    expect(node).toBeDefined();
    expect(node?.type).toBe("variable");
  });

  it("should filter out setState (index 1) for state hooks", () => {
    db.exec(`
            INSERT INTO entities (id, scope_id, kind, name, type) VALUES ('e-state', 's-module', 'state', 'count', 'function');
            -- State variable (index 0)
            INSERT INTO symbols (id, entity_id, scope_id, name, path) VALUES ('sym-state', 'e-state', 's-module', 'count', '[0]');
            -- State setter (index 1) - should be filtered
            INSERT INTO symbols (id, entity_id, scope_id, name, path) VALUES ('sym-setter', 'e-state', 's-module', 'setCount', '[1]');
        `);

    const context = {
      projectRoot: "/root",
      viewType: "component",
      cacheDbPath: dbPath,
    };

    db.close();
    const resultBuffer = runComponentTaskSqlite(context);
    const snapshot = materializeSqliteBuffer(resultBuffer as Buffer);

    const stateNodes = snapshot.nodes.filter(
      (n: OutNode) => n.name === "count" || n.name === "setCount",
    );
    expect(stateNodes.length).toBe(1);
    expect(stateNodes[0].name).toBe("count");
  });

  it("should process JSX renders into render groups and combos", () => {
    db.exec(`
            -- Component
            INSERT INTO entities (id, scope_id, kind, name, type) VALUES ('e-app', 's-module', 'component', 'App', 'function');
            INSERT INTO symbols (id, entity_id, scope_id, name) VALUES ('sym-app', 'e-app', 's-module', 'App');
            INSERT INTO scopes (id, file_id, parent_id, kind, entity_id) VALUES ('s-app-block', 1, 's-module', 'block', 'e-app');
            
            -- Render
            INSERT INTO renders (id, file_id, parent_entity_id, tag, kind) VALUES ('r-1', 1, 'e-app', 'div', 'jsx');
        `);

    const context = {
      projectRoot: "/root",
      viewType: "component",
      cacheDbPath: dbPath,
    };

    db.close();
    const resultBuffer = runComponentTaskSqlite(context);
    const snapshot = materializeSqliteBuffer(resultBuffer as Buffer);

    // Check for Render Group
    const renderGroup = snapshot.combos.find(
      (c: OutCombo) => c.type === "render-group",
    );
    expect(renderGroup).toBeDefined();
    expect(renderGroup?.combo).toBe("s-app-block");

    // Check for Render item
    const renderItem = snapshot.combos.find(
      (c: OutCombo) => c.type === "render",
    );
    expect(renderItem).toBeDefined();
    expect(renderItem?.name).toBe("div");
    expect(renderItem?.combo).toBe(renderGroup?.id);
  });

  it("should hide import nodes and redirect relations", () => {
    db.exec(`
            -- File 2 with export
            INSERT INTO files (id, path, package_id) VALUES (2, '/root/src/Comp.tsx', 'pkg-1');
            INSERT INTO scopes (id, file_id, parent_id, kind) VALUES ('s-comp-module', 2, NULL, 'module');
            INSERT INTO entities (id, scope_id, kind, name, type) VALUES ('e-comp', 's-comp-module', 'component', 'Comp', 'function');
            INSERT INTO symbols (id, entity_id, scope_id, name) VALUES ('sym-comp', 'e-comp', 's-comp-module', 'Comp');
            INSERT INTO exports (id, scope_id, symbol_id, entity_id, name) VALUES ('exp-1', 's-comp-module', 'sym-comp', 'e-comp', 'Comp');

            -- File 1 with import and usage
            INSERT INTO entities (id, scope_id, kind, name, type, data_json) VALUES ('e-import', 's-module', 'import', 'Comp', 'data', '{"source":"/root/src/Comp.tsx","importedName":"Comp"}');
            INSERT INTO symbols (id, entity_id, scope_id, name) VALUES ('sym-import', 'e-import', 's-module', 'Comp');
            INSERT INTO entities (id, scope_id, kind, name, type) VALUES ('e-app', 's-module', 'component', 'App', 'function');
            INSERT INTO symbols (id, entity_id, scope_id, name) VALUES ('sym-app', 'e-app', 's-module', 'App');
            
            -- Relation from App -> Import
            INSERT INTO relations (from_id, to_id, kind, data_json) VALUES ('sym-app', 'sym-import', 'usage-read', '{"filePath":"/root/src/App.tsx", "line":10}');
        `);

    const context = {
      projectRoot: "/root",
      viewType: "component",
      cacheDbPath: dbPath,
    };
    db.close();
    const snapshot = materializeSqliteBuffer(
      runComponentTaskSqlite(context) as Buffer,
    );

    // Verify import node is NOT present
    const importNode = snapshot.nodes.find(
      (n: OutNode) => n.id === "sym-import",
    );
    expect(importNode).toBeUndefined();

    // Verify edge is redirected to sym-comp
    const edge = snapshot.edges.find((e: OutEdge) => e.target === "sym-comp");
    expect(edge).toBeDefined();
    expect(edge?.source).toBe("sym-app");
    expect(edge?.kind).toBe("usage-read");
  });

  it("groups repeated usage relations into a single edge with occurrences", () => {
    db.exec(`
            INSERT INTO entities (id, scope_id, kind, name, type) VALUES ('e-app', 's-module', 'component', 'App', 'function');
            INSERT INTO symbols (id, entity_id, scope_id, name) VALUES ('sym-app', 'e-app', 's-module', 'App');
            INSERT INTO entities (id, scope_id, kind, name, type) VALUES ('e-util', 's-module', 'function', 'util', 'function');
            INSERT INTO symbols (id, entity_id, scope_id, name) VALUES ('sym-util', 'e-util', 's-module', 'util');

            INSERT INTO relations (from_id, to_id, kind, data_json) VALUES ('sym-app', 'sym-util', 'usage-read', '{"line":10}');
            INSERT INTO relations (from_id, to_id, kind, data_json) VALUES ('sym-app', 'sym-util', 'usage-read', '{"line":20}');
        `);

    db.close();
    const snapshot = materializeSqliteBuffer(
      runComponentTaskSqlite({
        projectRoot: "/root",
        viewType: "component",
        cacheDbPath: dbPath,
      }) as Buffer,
    );

    const edge = snapshot.edges.find(
      (e: OutEdge) => e.source === "sym-app" && e.target === "sym-util",
    );
    expect(edge).toBeDefined();

    const meta = JSON.parse(edge?.meta_json || "{}");
    expect(meta.usageCount).toBe(2);
    expect(meta.usages).toHaveLength(2);
  });

  it("should group destructured variables by their path", () => {
    db.exec(`
            INSERT INTO entities (id, scope_id, kind, name, type) VALUES ('e-hook', 's-module', 'hook', 'useTable', 'data');
            INSERT INTO symbols (id, entity_id, scope_id, name) VALUES ('sym-hook', 'e-hook', 's-module', 'useTable');
            INSERT INTO scopes (id, file_id, parent_id, kind, entity_id) VALUES ('s-app-block', 1, 's-module', 'block', NULL);

            -- Destructured symbol with path ["rows", "0", "original"]
            INSERT INTO symbols (id, entity_id, scope_id, name, path) VALUES ('sym-orig', 'e-hook', 's-app-block', 'original', '["rows", "0", "original"]');
        `);

    db.close();
    const snapshot = materializeSqliteBuffer(
      runComponentTaskSqlite({
        projectRoot: "/root",
        viewType: "component",
        cacheDbPath: dbPath,
      }) as Buffer,
    );

    // Path should create combos: s-app-block:source:e-hook -> ...path:rows -> ...path:rows/0
    const rowsCombo = snapshot.combos.find((c: OutCombo) => c.name === "rows");
    const indexCombo = snapshot.combos.find((c: OutCombo) => c.name === "0");

    expect(rowsCombo).toBeDefined();
    expect(indexCombo).toBeDefined();
    expect(indexCombo?.combo).toBe(rowsCombo?.id);

    const node = snapshot.nodes.find((n: OutNode) => n.id === "sym-orig");
    expect(node?.combo).toBe(indexCombo?.id);
  });

  it("should show effect nodes and their dependencies", () => {
    db.exec(`
            INSERT INTO entities (id, scope_id, kind, name, type, data_json) VALUES (
                'e-app', 's-module', 'component', 'App', 'function',
                '{"effects": {"eff-1": {"name": "useEffect", "loc": {"line": 10, "column": 5}, "reactDeps": [{"id": "sym-dep"}]}}}'
            );
            INSERT INTO symbols (id, entity_id, scope_id, name) VALUES ('sym-app', 'e-app', 's-module', 'App');
            INSERT INTO entities (id, scope_id, kind, name, type) VALUES ('e-dep', 's-module', 'state', 'count', 'data');
            INSERT INTO symbols (id, entity_id, scope_id, name) VALUES ('sym-dep', 'e-dep', 's-module', 'count');
        `);

    db.close();
    const snapshot = materializeSqliteBuffer(
      runComponentTaskSqlite({
        projectRoot: "/root",
        viewType: "component",
        cacheDbPath: dbPath,
      }) as Buffer,
    );

    const effectNode = snapshot.nodes.find((n: OutNode) => n.id === "eff-1");
    expect(effectNode).toBeDefined();
    expect(effectNode?.type).toBe("effect");

    const edge = snapshot.edges.find(
      (e: OutEdge) => e.target === "eff-1" && e.source === "sym-dep",
    );
    expect(edge).toBeDefined();
    expect(edge?.kind).toBe("effect-dep");
  });
});
