import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import type {
  ComponentFile,
  ComponentFileVar,
  ComponentFileVarJSX,
  ComponentInfoRender,
  VariableName,
  EntityRow,
  RelationRow,
  RenderRow,
  ExportRow,
} from "@nexu/shared";
import { SqliteDB as BaseSqliteDB } from "@nexu/shared/db";
import {
  getVariableNameKey,
  getPatternIdentifiers,
} from "../analyzer/pattern.js";

export interface AnalyzedFileResult {
  file: ComponentFile;
}

export class SqliteDB extends BaseSqliteDB {
  constructor(dbPath: string, options: { readonly?: boolean } = {}) {
    // Ensure directory exists if not readonly
    if (!options.readonly) {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    const db = new Database(dbPath, options);
    super(db);
    this.initSchema();
  }

  private initSchema() {
    // Check schema version to force updates
    const versionRow = this.db.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };
    const currentVersion = versionRow.user_version;
    const targetVersion = 3;

    if (currentVersion < targetVersion) {
      // Force recreation of affected tables to apply new schema/FK changes
      this.db.exec(`
        DROP TABLE IF EXISTS relations;
        DROP TABLE IF EXISTS exports;
        DROP TABLE IF EXISTS renders;
        DROP TABLE IF EXISTS symbols;
        DROP TABLE IF EXISTS scopes;
        DROP TABLE IF EXISTS entities;
        PRAGMA user_version = ${targetVersion};
      `);
    }

    // Drop old views if they exist (they conflict with the new tables)
    const viewNames = ["symbols", "renders"];
    for (const name of viewNames) {
      const info = this.db
        .prepare("SELECT type FROM sqlite_master WHERE name = ?")
        .get(name) as { type: string } | undefined;
      if (info && info.type === "view") {
        this.db.exec(`DROP VIEW ${name}`);
      }
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT UNIQUE NOT NULL,
        hash TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        default_export TEXT,
        star_exports_json TEXT
      );

      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        scope_id TEXT NOT NULL,
        kind TEXT NOT NULL, -- 'component', 'hook', 'function', 'class', 'variable', 'import', 'jsx', etc.
        name TEXT, -- The raw name or pattern
        type TEXT, -- 'function', 'data', 'jsx'
        line INTEGER,
        column INTEGER,
        end_line INTEGER,
        end_column INTEGER,
        declaration_kind TEXT, -- 'const', 'let', 'var'
        data_json TEXT,
        FOREIGN KEY (scope_id) REFERENCES scopes (id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS scopes (
        id TEXT PRIMARY KEY,
        file_id INTEGER NOT NULL,
        parent_id TEXT, -- parent scope
        kind TEXT NOT NULL, -- 'module', 'block'
        entity_id TEXT, -- the entity that owns this scope (if kind is 'block')
        data_json TEXT, -- e.g. return variable info
        FOREIGN KEY (file_id) REFERENCES files (id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS symbols (
        id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL, -- the declaration that produced this symbol
        scope_id TEXT NOT NULL,
        name TEXT NOT NULL,
        path TEXT, -- JSON path if destructured, e.g. "['test1']"
        is_alias BOOLEAN DEFAULT 0,
        has_default BOOLEAN DEFAULT 0,
        data_json TEXT,
        FOREIGN KEY (scope_id) REFERENCES scopes (id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS renders (
        id TEXT PRIMARY KEY,
        file_id INTEGER NOT NULL,
        parent_entity_id TEXT NOT NULL, -- referenced entity (e.g. the component or function where this is used)
        parent_render_id TEXT, -- hierarchy within JSX
        render_index INTEGER NOT NULL,
        tag TEXT NOT NULL,
        symbol_id TEXT, -- reference to the symbol (if it's a component/hook)
        line INTEGER,
        column INTEGER,
        kind TEXT NOT NULL, -- 'jsx', 'ternary', 'loop', etc.
        data_json TEXT,
        FOREIGN KEY (file_id) REFERENCES files (id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS exports (
        id TEXT PRIMARY KEY,
        scope_id TEXT NOT NULL, -- module scope
        symbol_id TEXT, -- the symbol being exported
        entity_id TEXT, -- for anonymous exports
        name TEXT, -- export name
        is_default BOOLEAN DEFAULT 0,
        FOREIGN KEY (scope_id) REFERENCES scopes (id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS relations (
        from_id TEXT NOT NULL, -- Can be symbol_id or entity_id depending on context
        to_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        line INTEGER,
        column INTEGER,
        data_json TEXT,
        PRIMARY KEY (from_id, to_id, kind, line, column)
      );

      CREATE INDEX IF NOT EXISTS idx_entities_scope ON entities (scope_id);
      CREATE INDEX IF NOT EXISTS idx_scopes_file ON scopes (file_id);
      CREATE INDEX IF NOT EXISTS idx_symbols_scope ON symbols (scope_id);
      CREATE INDEX IF NOT EXISTS idx_symbols_entity ON symbols (entity_id);
      CREATE INDEX IF NOT EXISTS idx_renders_parent ON renders (parent_entity_id);
      CREATE INDEX IF NOT EXISTS idx_renders_hierarchy ON renders (parent_render_id);
      CREATE INDEX IF NOT EXISTS idx_exports_scope ON exports (scope_id);
      CREATE INDEX IF NOT EXISTS idx_relations_from ON relations (from_id);
      CREATE INDEX IF NOT EXISTS idx_relations_to ON relations (to_id);
    `);
  }

  private insertEntity(data: {
    id: string;
    scope_id: string;
    kind: string;
    name: VariableName | string;
    type?: string | null;
    line?: number | null | undefined;
    column?: number | null | undefined;
    end_line?: number | null | undefined;
    end_column?: number | null | undefined;
    declaration_kind?: string | null | undefined;
    data_json?: string | null;
  }) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO entities 
      (id, scope_id, kind, name, type, line, column, end_line, end_column, declaration_kind, data_json)
      VALUES (@id, @scope_id, @kind, @name, @type, @line, @column, @end_line, @end_column, @declaration_kind, @data_json)
    `);

    const nameStr =
      typeof data.name === "string" ? data.name : getVariableNameKey(data.name);
    const params = {
      id: data.id,
      scope_id: data.scope_id,
      kind: data.kind,
      name: nameStr,
      type: data.type || null,
      line: data.line ?? null,
      column: data.column ?? null,
      end_line: data.end_line ?? null,
      end_column: data.end_column ?? null,
      declaration_kind: data.declaration_kind || null,
      data_json: data.data_json || null,
    };

    stmt.run(params);
  }

  private insertScope(data: {
    id: string;
    file_id: number;
    parent_id?: string | null;
    kind: "module" | "block";
    entity_id?: string | null;
    data_json?: string | null;
  }) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO scopes (id, file_id, parent_id, kind, entity_id, data_json)
      VALUES (@id, @file_id, @parent_id, @kind, @entity_id, @data_json)
    `);
    stmt.run({
      id: data.id,
      file_id: data.file_id,
      parent_id: data.parent_id || null,
      kind: data.kind,
      entity_id: data.entity_id || null,
      data_json: data.data_json || null,
    });
  }

  private insertSymbol(data: {
    id: string;
    entity_id: string;
    scope_id: string;
    name: string;
    path?: string | null;
    is_alias?: boolean;
    has_default?: boolean;
    data_json?: string | null;
  }) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO symbols (id, entity_id, scope_id, name, path, is_alias, has_default, data_json)
      VALUES (@id, @entity_id, @scope_id, @name, @path, @is_alias, @has_default, @data_json)
    `);
    stmt.run({
      id: data.id,
      entity_id: data.entity_id,
      scope_id: data.scope_id,
      name: data.name,
      path: data.path || null,
      is_alias: data.is_alias ? 1 : 0,
      has_default: data.has_default ? 1 : 0,
      data_json: data.data_json || null,
    });
  }

  private insertRender(data: {
    id: string;
    file_id: number;
    parent_entity_id: string;
    parent_render_id?: string | null;
    render_index: number;
    tag: string;
    symbol_id?: string | null;
    line?: number | null;
    column?: number | null;
    kind: string;
    data_json?: string | null;
  }) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO renders (id, file_id, parent_entity_id, parent_render_id, render_index, tag, symbol_id, line, column, kind, data_json)
      VALUES (@id, @file_id, @parent_entity_id, @parent_render_id, @render_index, @tag, @symbol_id, @line, @column, @kind, @data_json)
    `);
    stmt.run({
      id: data.id,
      file_id: data.file_id,
      parent_entity_id: data.parent_entity_id,
      parent_render_id: data.parent_render_id || null,
      render_index: data.render_index,
      tag: data.tag || "unknown",
      symbol_id: data.symbol_id || null,
      line: data.line ?? null,
      column: data.column ?? null,
      kind: data.kind,
      data_json: data.data_json || null,
    });
  }

  private insertExport(data: {
    id: string;
    scope_id: string;
    symbol_id?: string | null;
    entity_id?: string | null;
    name?: string | null;
    is_default?: boolean;
  }) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO exports (id, scope_id, symbol_id, entity_id, name, is_default)
      VALUES (@id, @scope_id, @symbol_id, @entity_id, @name, @is_default)
    `);
    stmt.run({
      id: data.id,
      scope_id: data.scope_id,
      symbol_id: data.symbol_id || null,
      entity_id: data.entity_id || null,
      name: data.name || null,
      is_default: data.is_default ? 1 : 0,
    });
  }

  public deleteFile(filePath: string) {
    const file = this.getFileByPath(filePath);
    if (file) {
      this.db.prepare("DELETE FROM files WHERE id = ?").run(file.id);
    }
  }

  public saveFileResults(fileData: ComponentFile) {
    const transaction = this.db.transaction((data: ComponentFile) => {
      // 1. Insert/Update file
      this.db
        .prepare(
          `
        INSERT OR REPLACE INTO files (path, hash, fingerprint, default_export, star_exports_json)
        VALUES (?, ?, ?, ?, ?)
      `,
        )
        .run(
          data.path,
          data.hash,
          data.fingerPrint,
          data.defaultExport,
          JSON.stringify(data.starExports || []),
        );

      const file = this.getFileByPath(data.path);
      if (!file) return;
      const fileId = file.id;

      // Clean up old data for this file
      this.db
        .prepare(
          "DELETE FROM relations WHERE from_id IN (SELECT e.id FROM entities e JOIN scopes s ON e.scope_id = s.id WHERE s.file_id = ?)",
        )
        .run(fileId);
      this.db
        .prepare(
          "DELETE FROM exports WHERE scope_id IN (SELECT id FROM scopes WHERE file_id = ?)",
        )
        .run(fileId);
      this.db.prepare("DELETE FROM renders WHERE file_id = ?").run(fileId);
      this.db
        .prepare(
          "DELETE FROM symbols WHERE scope_id IN (SELECT id FROM scopes WHERE file_id = ?)",
        )
        .run(fileId);
      this.db.prepare("DELETE FROM scopes WHERE file_id = ?").run(fileId);

      // 2. Create module scope
      const moduleScopeId = `scope:module:${data.path}`;
      this.insertScope({
        id: moduleScopeId,
        file_id: fileId,
        kind: "module",
      });

      // 3. Insert Imports as entities and symbols
      for (const imp of Object.values(data.import)) {
        const impId = `entity:import:${data.path}:${imp.localName}`;
        this.insertEntity({
          id: impId,
          scope_id: moduleScopeId,
          kind: "import",
          name: imp.localName,
          type: "data",
          data_json: JSON.stringify(imp),
        });

        this.insertSymbol({
          id: `symbol:import:${data.path}:${imp.localName}`,
          entity_id: impId,
          scope_id: moduleScopeId,
          name: imp.localName,
          is_alias: imp.localName !== imp.importedName,
        });
      }

      // 4. Helper for recursive variable and render insertion
      const insertRender = (
        render: ComponentInfoRender,
        parentEntityId: string,
        currentScopeId: string,
        parentRenderId?: string,
      ) => {
        this.insertRender({
          id: render.instanceId,
          file_id: fileId,
          parent_entity_id: parentEntityId,
          parent_render_id: parentRenderId || null,
          render_index: render.renderIndex,
          tag: render.tag,
          symbol_id: render.id,
          line: render.loc.line,
          column: render.loc.column,
          kind: render.kind,
          data_json: JSON.stringify({
            dependencies: render.dependencies,
            isDependency: render.isDependency,
          }),
        });

        for (const child of Object.values(render.children || {})) {
          insertRender(
            child,
            parentEntityId,
            currentScopeId,
            render.instanceId,
          );
        }
      };

      const insertVariable = (
        v: ComponentFileVar,
        currentScopeId: string,
        parentEntityId?: string,
      ) => {
        const nameStr = getVariableNameKey(v.name);
        const scope = "scope" in v ? v.scope : undefined;

        this.insertEntity({
          id: v.id,
          scope_id: currentScopeId,
          kind: v.kind,
          name: nameStr,
          type: v.type,
          line: v.loc.line,
          column: v.loc.column,
          end_line: scope?.end?.line,
          end_column: scope?.end?.column,
          declaration_kind: v.declarationKind,
          data_json: JSON.stringify(this.getVariableMetadata(v)),
        });

        // Index all names in the pattern as symbols
        const identifiers = getPatternIdentifiers(v.name, v.id);
        for (const ident of identifiers) {
          this.insertSymbol({
            id: ident.id,
            entity_id: v.id,
            scope_id: currentScopeId,
            name: ident.name,
            path: ident.path.length > 0 ? JSON.stringify(ident.path) : null,
            is_alias: ident.isAlias,
            has_default: ident.hasDefault,
          });
        }

        if (parentEntityId) {
          this.db
            .prepare(
              "INSERT OR REPLACE INTO relations (from_id, to_id, kind) VALUES (?, ?, ?)",
            )
            .run(parentEntityId, v.id, "parent-child");
        }

        // If it's a function/jsx, it has its own scope
        if (
          (v.type === "function" || v.type === "jsx") &&
          ("var" in v || "children" in v)
        ) {
          const newScopeId = `scope:block:${v.id}`;
          this.insertScope({
            id: newScopeId,
            file_id: fileId,
            parent_id: currentScopeId,
            kind: "block",
            entity_id: v.id,
          });

          if (v.type === "jsx") {
            const jsx = v as ComponentFileVarJSX;
            this.insertRender({
              id: v.id,
              file_id: fileId,
              parent_entity_id: parentEntityId || v.id,
              render_index: 0,
              tag: jsx.tag || "unknown",
              symbol_id: jsx.srcId || null,
              line: v.loc.line,
              column: v.loc.column,
              kind: "jsx",
              data_json: JSON.stringify({
                dependencies: v.dependencies,
                props: jsx.props,
              }),
            });
          }

          if ("var" in v) {
            for (const childVar of Object.values(v.var || {})) {
              insertVariable(childVar, newScopeId, v.id);
            }
          }

          if ("children" in v) {
            for (const render of Object.values(v.children || {})) {
              insertRender(render, v.id, newScopeId);
            }
          }
        }
      };

      // 5. Insert Variables (recursive)
      for (const v of Object.values(data.var)) {
        insertVariable(v, moduleScopeId);
      }

      // 6. Insert Exports
      for (const exp of Object.values(data.export)) {
        // Find if this export refers to a symbol we just added
        let symbolId: string | undefined;
        let entityId: string | undefined = exp.id;

        if (exp.type === "named") {
          // Typically points to a variable in the same file
          const varId = `entity:${data.path}:${exp.name}`;
          entityId = varId;
          symbolId = `symbol:${data.path}:${exp.name}`;
        }

        this.insertExport({
          id: `export:${data.path}:${exp.name}`,
          scope_id: moduleScopeId,
          entity_id: entityId ?? null,
          symbol_id: symbolId ?? null,
          name: exp.name,
          is_default: exp.type === "default",
        });
      }

      // 7. Insert TS Types
      for (const type of Object.values(data.tsTypes)) {
        this.insertEntity({
          id: type.id,
          scope_id: moduleScopeId,
          kind: "type",
          name: type.name,
          line: type.loc.line,
          column: type.loc.column,
          data_json: JSON.stringify(type),
        });
      }
    });

    transaction(fileData);
  }

  private getVariableMetadata(v: ComponentFileVar) {
    const {
      id: _id,
      name: _name,
      file: _file,
      kind: _kind,
      type: _type,
      loc: _loc,
      ...rest
    } = v;
    return rest;
  }

  public loadFileResults(filePath: string): ComponentFile | undefined {
    const fileRow = this.getFileByPath(filePath);
    if (!fileRow) return undefined;

    const fileId = fileRow.id;
    const entities = this.db
      .prepare(
        "SELECT e.* FROM entities e JOIN scopes s ON e.scope_id = s.id WHERE s.file_id = ?",
      )
      .all(fileId) as EntityRow[];
    const renders = this.db
      .prepare("SELECT * FROM renders WHERE file_id = ? ORDER BY render_index")
      .all(fileId) as RenderRow[];
    const exports_ = this.db
      .prepare(
        "SELECT e.* FROM exports e JOIN scopes sc ON e.scope_id = sc.id WHERE sc.file_id = ?",
      )
      .all(fileId) as ExportRow[];

    const result: ComponentFile = {
      path: fileRow.path,
      hash: fileRow.hash,
      fingerPrint: fileRow.fingerprint,
      defaultExport: fileRow.default_export,
      starExports: JSON.parse(fileRow.star_exports_json || "[]"),
      import: {},
      export: {},
      tsTypes: {},
      var: {},
    };

    const entityMap = new Map<string, EntityRow>();
    for (const e of entities) entityMap.set(e.id, e);

    // Reconstruct imports
    for (const e of entities.filter((e) => e.kind === "import")) {
      result.import[e.name!] = JSON.parse(e.data_json || "{}");
    }

    // Reconstruct exports
    for (const exp of exports_) {
      if (exp.name == null) continue;

      result.export[exp.name] = {
        id: exp.entity_id || (exp.symbol_id ? exp.symbol_id : ""),
        name: exp.name,
        type: exp.is_default ? "default" : "named",
        exportKind: "value", // Default, could be refined
      };
    }

    // Reconstruct TS types
    for (const e of entities.filter((e) => e.kind === "type")) {
      result.tsTypes[e.id] = JSON.parse(e.data_json || "{}");
    }

    // Reconstruct Variables and Renders
    const varMap = new Map<string, ComponentFileVar>();

    // First pass: Create variable objects
    for (const e of entities) {
      if (["import", "type"].includes(e.kind)) continue;

      const metadata = JSON.parse(e.data_json || "{}");
      const varObj = {
        id: e.id,
        kind: e.kind,
        name:
          e.name && (e.name.startsWith("{") || e.name.startsWith("["))
            ? JSON.parse(e.name)
            : e.name,
        type: e.type,
        loc: { line: e.line || 0, column: e.column || 0 },
        ...metadata,
      };

      if (e.type === "function") {
        varObj.var = {};
        varObj.children = {};
        varObj.scope = {
          start: { line: e.line || 0, column: e.column || 0 },
          end: { line: e.end_line || 0, column: e.end_column || 0 },
        };
      } else if (e.type === "jsx") {
        varObj.children = {};
      }

      varMap.set(e.id, varObj);
    }

    // Connect hierarchy
    const relations = this.db
      .prepare(
        `
      SELECT r.* FROM relations r 
      JOIN entities e ON r.from_id = e.id 
      JOIN scopes s ON e.scope_id = s.id
      WHERE s.file_id = ? AND r.kind = 'parent-child'
    `,
      )
      .all(fileId) as RelationRow[];

    for (const rel of relations) {
      const parent = varMap.get(rel.from_id);
      const child = varMap.get(rel.to_id);
      if (parent && child && parent.type === "function" && parent.var) {
        parent.var[child.id] = child;
      }
    }

    // Root variables
    const childIds = new Set(relations.map((r) => r.to_id));
    for (const [id, v] of varMap.entries()) {
      if (!childIds.has(id)) {
        result.var[id] = v;
      }
    }

    // Reconstruct renders hierarchy
    const renderMap = new Map<string, ComponentInfoRender>();
    for (const r of renders) {
      const data = JSON.parse(r.data_json || "{}");
      const renderObj: ComponentInfoRender = {
        instanceId: r.id,
        tag: r.tag,
        id: r.symbol_id || r.tag,
        loc: { line: r.line || 0, column: r.column || 0 },
        dependencies: data.dependencies || [],
        isDependency: data.isDependency,
        renderIndex: r.render_index,
        kind: r.kind as ComponentInfoRender["kind"],
        children: {},
      };
      renderMap.set(r.id, renderObj);
    }

    for (const r of renders) {
      if (r.parent_render_id) {
        const parent = renderMap.get(r.parent_render_id);
        const child = renderMap.get(r.id);
        if (parent && child) {
          parent.children[child.instanceId] = child;
        }
      } else {
        const parentEntity = varMap.get(r.parent_entity_id);
        const render = renderMap.get(r.id);
        if (
          parentEntity &&
          render &&
          "children" in parentEntity &&
          parentEntity.children
        ) {
          parentEntity.children[render.instanceId] = render;
        }
      }
    }

    return result;
  }

  public saveEdges(edges: { from: string; to: string; label: string }[]) {
    const transaction = this.db.transaction(
      (edgeList: { from: string; to: string; label: string }[]) => {
        const stmt = this.db.prepare(
          "INSERT OR IGNORE INTO relations (from_id, to_id, kind, line, column) VALUES (?, ?, ?, 0, 0)",
        );
        for (const edge of edgeList) {
          stmt.run(edge.from, edge.to, edge.label);
        }
      },
    );
    transaction(edges);
  }
}
