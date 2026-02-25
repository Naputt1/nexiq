import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import type {
  ComponentFile,
  ComponentFileVar,
  ComponentInfoRender,
} from "shared";
import { getPatternIdentifiers } from "../analyzer/pattern.js";

export interface AnalyzedFileResult {
  file: ComponentFile;
}

interface FileRow {
  id: number;
  path: string;
  hash: string;
  fingerprint: string;
  default_export: string | null;
  star_exports_json: string | null;
}

interface EntityRow {
  id: string;
  file_id: number;
  kind: string;
  name: string;
  type: string | null;
  line: number | null;
  column: number | null;
  end_line: number | null;
  end_column: number | null;
  declaration_kind: string | null;
  data_json: string | null;
}

interface RelationRow {
  from_id: string;
  to_id: string;
  kind: string;
  line: number | null;
  column: number | null;
  data_json: string | null;
}

export class SqliteDB {
  public db: Database.Database;

  constructor(dbPath: string) {
    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.initSchema();
  }

  private initSchema() {
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
        file_id INTEGER NOT NULL,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT,
        line INTEGER,
        column INTEGER,
        end_line INTEGER,
        end_column INTEGER,
        declaration_kind TEXT,
        data_json TEXT,
        FOREIGN KEY (file_id) REFERENCES files (id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS relations (
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        line INTEGER,
        column INTEGER,
        data_json TEXT,
        PRIMARY KEY (from_id, to_id, kind, line, column)
      );

      CREATE INDEX IF NOT EXISTS idx_entities_file ON entities (file_id);
      CREATE INDEX IF NOT EXISTS idx_entities_kind ON entities (kind);
      CREATE INDEX IF NOT EXISTS idx_entities_name ON entities (name);
      CREATE INDEX IF NOT EXISTS idx_relations_from ON relations (from_id);
      CREATE INDEX IF NOT EXISTS idx_relations_to ON relations (to_id);
      CREATE INDEX IF NOT EXISTS idx_relations_kind ON relations (kind);

      -- Backward compatibility views
      DROP VIEW IF EXISTS symbols;
      CREATE VIEW symbols AS
      SELECT id, name, (SELECT path FROM files WHERE id = file_id) as file, line, column, kind, type, 
             JSON_EXTRACT(data_json, '$.props') as props_json,
             JSON_EXTRACT(data_json, '$.return') as return_json
      FROM entities
      WHERE kind NOT IN ('render-instance', 'import', 'export', 'type');

      DROP VIEW IF EXISTS renders;
      CREATE VIEW renders AS
      -- JSX Renders
      SELECT e.id as id, 
             JSON_EXTRACT(e.data_json, '$.srcId') as symbol_id, 
             e.name as tag, 
             (SELECT path FROM files WHERE id = e.file_id) as file, 
             e.line, e.column,
             (SELECT from_id FROM relations WHERE to_id = e.id AND kind = 'renders') as scope_symbol_id,
             'render' as usage_kind
      FROM entities e
      WHERE e.kind = 'render-instance'
      UNION ALL
      -- Hook Calls and other relations
      SELECT r.from_id as id,
             r.to_id as symbol_id,
             (SELECT name FROM entities WHERE id = r.to_id) as tag,
             (SELECT path FROM files WHERE id = (SELECT file_id FROM entities WHERE id = r.from_id)) as file,
             r.line, r.column,
             (SELECT from_id FROM relations WHERE to_id = r.from_id AND kind = 'parent-child') as scope_symbol_id,
             r.kind as usage_kind
      FROM relations r
      WHERE r.kind IN ('hook', 'calls', 'hook-call');
    `);
  }

  public getFileByPath(filePath: string): FileRow | undefined {
    return this.db
      .prepare("SELECT * FROM files WHERE path = ?")
      .get(filePath) as FileRow | undefined;
  }

  private insertEntity(data: {
    id: string;
    file_id: number;
    kind: string;
    name: unknown;
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
      (id, file_id, kind, name, type, line, column, end_line, end_column, declaration_kind, data_json)
      VALUES (@id, @file_id, @kind, @name, @type, @line, @column, @end_line, @end_column, @declaration_kind, @data_json)
    `);

    const nameStr =
      typeof data.name === "string" ? data.name : JSON.stringify(data.name);
    const params = {
      id: data.id,
      file_id: data.file_id,
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

      this.db
        .prepare(
          `
        DELETE FROM relations WHERE from_id IN (SELECT id FROM entities WHERE file_id = ?)
        OR to_id IN (SELECT id FROM entities WHERE file_id = ?)
      `,
        )
        .run(fileId, fileId);
      this.db.prepare("DELETE FROM entities WHERE file_id = ?").run(fileId);

      // 2. Insert Imports as entities and relations
      for (const imp of Object.values(data.import)) {
        const impId = `import:${data.path}:${imp.localName}`;
        this.insertEntity({
          id: impId,
          file_id: fileId,
          kind: "import",
          name: imp.localName,
          type: imp.type,
          data_json: JSON.stringify(imp),
        });
      }

      // 3. Insert Exports as entities and relations
      for (const exp of Object.values(data.export)) {
        this.insertEntity({
          id: exp.id,
          file_id: fileId,
          kind: "export",
          name: exp.name,
          type: exp.type,
          data_json: JSON.stringify(exp),
        });
      }

      // 4. Insert TS Types as entities
      for (const type of Object.values(data.tsTypes)) {
        this.insertEntity({
          id: type.id,
          file_id: fileId,
          kind: "type",
          name: type.name,
          line: type.loc.line,
          column: type.loc.column,
          data_json: JSON.stringify(type),
        });
      }

      // 5. Insert Variables (recursive)
      const insertVariable = (v: ComponentFileVar, parentId?: string) => {
        const nameStr =
          typeof v.name === "string" ? v.name : JSON.stringify(v.name);
        const scope = "scope" in v ? v.scope : undefined;
        this.insertEntity({
          id: v.id,
          file_id: fileId,
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

        // Index individual identifiers if name is a pattern
        if (typeof v.name !== "string") {
          const identifiers = getPatternIdentifiers(v.name);
          for (const ident of identifiers) {
            if (ident.id !== v.id) {
              this.insertEntity({
                id: ident.id,
                file_id: fileId,
                kind: v.kind, // Use same kind (component, hook, etc)
                name: ident.name,
                type: v.type,
                line: v.loc.line,
                column: v.loc.column,
                end_line: scope?.end?.line,
                end_column: scope?.end?.column,
                declaration_kind: v.declarationKind,
                data_json: JSON.stringify({
                  ...this.getVariableMetadata(v),
                  isAlias: true,
                  aliasFor: v.id,
                }),
              });
            }
          }
        }

        if (parentId) {
          this.db
            .prepare(
              `
            INSERT OR REPLACE INTO relations (from_id, to_id, kind)
            VALUES (?, ?, ?)
          `,
            )
            .run(parentId, v.id, "parent-child");
        }

        // Recursively insert nested variables (scopes)
        if (v.type === "function" && "var" in v && v.var) {
          for (const childVar of Object.values(v.var)) {
            insertVariable(childVar as ComponentFileVar, v.id);
          }
        }

        // Insert renders for this variable
        if ("children" in v && v.children) {
          for (const render of Object.values(v.children)) {
            insertRender(render as ComponentInfoRender, v.id);
          }
        }
      };

      const insertRender = (
        r: ComponentInfoRender,
        scopeId: string,
        parentInstanceId?: string,
      ) => {
        this.insertEntity({
          id: r.instanceId,
          file_id: fileId,
          kind: "render-instance",
          name: r.tag,
          line: r.loc.line,
          column: r.loc.column,
          data_json: JSON.stringify({
            dependencies: r.dependencies,
            isDependency: r.isDependency,
            srcId: r.id,
          }),
        });

        // Relation from scope to render
        this.db
          .prepare(
            `
          INSERT OR REPLACE INTO relations (from_id, to_id, kind, line, column)
          VALUES (?, ?, ?, ?, ?)
        `,
          )
          .run(scopeId, r.instanceId, "renders", r.loc.line, r.loc.column);

        // Relation from parent render to child render
        if (parentInstanceId) {
          this.db
            .prepare(
              `
            INSERT OR REPLACE INTO relations (from_id, to_id, kind)
            VALUES (?, ?, ?)
          `,
            )
            .run(parentInstanceId, r.instanceId, "parent-child");
        }

        // Relation to the source component if known (srcId)
        if (r.id) {
          this.db
            .prepare(
              `
            INSERT OR IGNORE INTO relations (from_id, to_id, kind)
            VALUES (?, ?, ?)
          `,
            )
            .run(r.instanceId, r.id, "calls");
        }

        for (const child of Object.values(r.children || {})) {
          insertRender(child, scopeId, r.instanceId);
        }
      };

      for (const v of Object.values(data.var)) {
        insertVariable(v);
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
      .prepare("SELECT * FROM entities WHERE file_id = ?")
      .all(fileId) as EntityRow[];
    const relations = this.db
      .prepare(
        `
      SELECT r.* FROM relations r 
      JOIN entities e ON r.from_id = e.id 
      WHERE e.file_id = ?
    `,
      )
      .all(fileId) as RelationRow[];

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
    for (const e of entities) {
      entityMap.set(e.id, e);
    }

    // Reconstruct imports
    for (const e of entities.filter((e) => e.kind === "import")) {
      result.import[e.name] = JSON.parse(e.data_json || "{}");
    }

    // Reconstruct exports
    for (const e of entities.filter((e) => e.kind === "export")) {
      result.export[e.name] = JSON.parse(e.data_json || "{}");
    }

    // Reconstruct TS types
    for (const e of entities.filter((e) => e.kind === "type")) {
      result.tsTypes[e.id] = JSON.parse(e.data_json || "{}");
    }

    // Reconstruct Variables and Renders
    const variables = entities.filter(
      (e) => !["import", "export", "type", "render-instance"].includes(e.kind),
    );
    const renders = entities.filter((e) => e.kind === "render-instance");

    const varMap = new Map<string, ComponentFileVar>();

    // First pass: Create variable objects
    for (const v of variables) {
      const metadata = JSON.parse(v.data_json || "{}");
      const varObj = {
        id: v.id,
        kind: v.kind,
        name:
          v.name.startsWith("{") || v.name.startsWith("[")
            ? JSON.parse(v.name)
            : v.name,
        type: v.type,
        loc: { line: v.line || 0, column: v.column || 0 },
        ...metadata,
      } as ComponentFileVar;

      if (v.type === "function") {
        const funcVar = varObj as Extract<
          ComponentFileVar,
          { type: "function" }
        >;
        funcVar.var = {};
        funcVar.children = {};
        funcVar.scope = {
          start: { line: v.line || 0, column: v.column || 0 },
          end: { line: v.end_line || 0, column: v.end_column || 0 },
        };
      } else if (v.type === "jsx") {
        const jsxVar = varObj as Extract<ComponentFileVar, { type: "jsx" }>;
        jsxVar.children = {};
      }

      varMap.set(v.id, varObj);
    }

    // Second pass: Establish parent-child for variables
    for (const rel of relations.filter((r) => r.kind === "parent-child")) {
      const parent = varMap.get(rel.from_id);
      const child = varMap.get(rel.to_id);
      if (
        parent &&
        child &&
        parent.type === "function" &&
        "var" in parent &&
        parent.var
      ) {
        parent.var[child.id] = child;
      }
    }

    // Root variables (those without a parent-child relation where they are the child)
    const childIds = new Set(
      relations.filter((r) => r.kind === "parent-child").map((r) => r.to_id),
    );
    for (const [id, v] of varMap.entries()) {
      if (!childIds.has(id)) {
        result.var[id] = v;
      }
    }

    // Reconstruct renders
    const renderMap = new Map<string, ComponentInfoRender>();
    for (const r of renders) {
      const data = JSON.parse(r.data_json || "{}");
      const renderObj: ComponentInfoRender = {
        instanceId: r.id,
        tag: r.name,
        id: data.srcId,
        loc: { line: r.line || 0, column: r.column || 0 },
        dependencies: data.dependencies || [],
        isDependency: data.isDependency,
        children: {},
      };
      renderMap.set(r.id, renderObj);
    }

    // Establish render hierarchy
    for (const rel of relations.filter((r) => r.kind === "parent-child")) {
      const parent = renderMap.get(rel.from_id);
      const child = renderMap.get(rel.to_id);
      if (parent && child) {
        parent.children[child.instanceId] = child;
      }
    }

    // Attach root renders to variables/scopes
    for (const rel of relations.filter((r) => r.kind === "renders")) {
      const scope = varMap.get(rel.from_id);
      const render = renderMap.get(rel.to_id);
      if (scope && render) {
        // Only attach if it's a top-level render for this scope
        const isChildRender = relations.some(
          (r) => r.kind === "parent-child" && r.to_id === render.instanceId,
        );
        if (!isChildRender) {
          if (
            (scope.type === "function" || scope.type === "jsx") &&
            "children" in scope &&
            scope.children
          ) {
            scope.children[render.instanceId] = render;
          }
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

  public getEdges(): { from: string; to: string; label: string }[] {
    const rows = this.db
      .prepare(
        `
      SELECT from_id as 'from', to_id as 'to', kind as label 
      FROM relations 
      WHERE kind NOT IN ('parent-child', 'renders', 'calls')
    `,
      )
      .all() as { from: string; to: string; label: string }[];
    return rows;
  }

  public close() {
    this.db.close();
  }
}
