import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import type {
  AnalysisRunRow,
  ComponentFileBlockScope,
  ComponentFile,
  ComponentFileVar,
  ComponentInfoRender,
  ExportRow,
  FileAnalysisErrorRow,
  EntityRow,
  PackageRow,
  RelationRow,
  RenderRow,
  ResolveErrorRow,
  VariableName,
} from "@nexiq/shared";
import { SqliteDB as BaseSqliteDB } from "@nexiq/shared/db";
import {
  getVariableNameKey,
  getPatternIdentifiers,
} from "../analyzer/pattern.ts";
import type { FileRunStatus } from "../types.ts";

export interface AnalyzedFileResult {
  file: ComponentFile;
}

type FileResultWithPackage = ComponentFile & {
  package_id?: string | undefined;
};

export class SqliteDB extends BaseSqliteDB {
  constructor(dbPath: string, options: { readonly?: boolean } = {}) {
    // Ensure directory exists if not readonly
    if (!options.readonly) {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    let db: Database.Database;
    try {
      db = new Database(dbPath, options);
      // Try a simple pragma to verify the database is valid
      db.pragma("user_version");
    } catch (e: unknown) {
      if (options.readonly) {
        throw e;
      }
      try {
        if (fs.existsSync(dbPath)) {
          fs.unlinkSync(dbPath);
          // Also delete -shm and -wal if they exist
          if (fs.existsSync(`${dbPath}-shm`)) fs.unlinkSync(`${dbPath}-shm`);
          if (fs.existsSync(`${dbPath}-wal`)) fs.unlinkSync(`${dbPath}-wal`);
        }
      } catch (unlinkError) {
        console.error(
          `Failed to delete corrupted database at ${dbPath}:`,
          unlinkError instanceof Error ? unlinkError.message : "Unknown error",
        );
      }
      db = new Database(dbPath, options);
    }
    super(db);
    this.initSchema();
  }

  private initSchema() {
    // Check schema version to force updates
    const versionRow = this.db.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };
    const currentVersion = versionRow.user_version;
    const targetVersion = 5;

    if (currentVersion < targetVersion) {
      // Force recreation of affected tables to apply new schema/FK changes
      this.db.exec(`
        DROP TABLE IF EXISTS relations;
        DROP TABLE IF EXISTS exports;
        DROP TABLE IF EXISTS renders;
        DROP TABLE IF EXISTS symbols;
        DROP TABLE IF EXISTS scopes;
        DROP TABLE IF EXISTS entities;
        DROP TABLE IF EXISTS files;
        DROP TABLE IF EXISTS package_dependencies;
        DROP TABLE IF EXISTS packages;
        DROP TABLE IF EXISTS resolve_errors;
        DROP TABLE IF EXISTS file_analysis_errors;
        DROP TABLE IF EXISTS file_run_status;
        DROP TABLE IF EXISTS analysis_runs;
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
      CREATE TABLE IF NOT EXISTS packages (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        path TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS package_dependencies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        package_id TEXT NOT NULL,
        dependency_name TEXT NOT NULL,
        dependency_version TEXT NOT NULL,
        is_dev BOOLEAN DEFAULT 0,
        FOREIGN KEY (package_id) REFERENCES packages (id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT UNIQUE NOT NULL,
        package_id TEXT,
        hash TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        default_export TEXT,
        star_exports_json TEXT,
        FOREIGN KEY (package_id) REFERENCES packages (id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS analysis_runs (
        id TEXT PRIMARY KEY,
        package_id TEXT,
        src_dir TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        FOREIGN KEY (package_id) REFERENCES packages (id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS file_run_status (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        package_id TEXT,
        file_path TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        attempt INTEGER NOT NULL DEFAULT 1,
        file_hash TEXT,
        fingerprint TEXT,
        FOREIGN KEY (run_id) REFERENCES analysis_runs (id) ON DELETE CASCADE,
        FOREIGN KEY (package_id) REFERENCES packages (id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS file_analysis_errors (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        package_id TEXT,
        file_path TEXT NOT NULL,
        stage TEXT NOT NULL,
        error_code TEXT,
        message TEXT NOT NULL,
        line INTEGER,
        column INTEGER,
        stack TEXT,
        parser TEXT,
        file_hash TEXT,
        fingerprint TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES analysis_runs (id) ON DELETE CASCADE,
        FOREIGN KEY (package_id) REFERENCES packages (id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS resolve_errors (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        package_id TEXT,
        file_path TEXT NOT NULL,
        scope_id TEXT,
        entity_id TEXT,
        relation_kind TEXT NOT NULL,
        source_name TEXT,
        source_module TEXT,
        target_hint TEXT,
        resolver_stage TEXT NOT NULL,
        message TEXT NOT NULL,
        loc_line INTEGER,
        loc_column INTEGER,
        retry_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES analysis_runs (id) ON DELETE CASCADE,
        FOREIGN KEY (package_id) REFERENCES packages (id) ON DELETE SET NULL
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
      CREATE INDEX IF NOT EXISTS idx_files_package ON files (package_id);
      CREATE INDEX IF NOT EXISTS idx_package_dependencies_package ON package_dependencies (package_id);
      CREATE INDEX IF NOT EXISTS idx_analysis_runs_package ON analysis_runs (package_id);
      CREATE INDEX IF NOT EXISTS idx_file_run_status_run ON file_run_status (run_id);
      CREATE INDEX IF NOT EXISTS idx_file_run_status_file ON file_run_status (file_path);
      CREATE INDEX IF NOT EXISTS idx_file_analysis_errors_run ON file_analysis_errors (run_id);
      CREATE INDEX IF NOT EXISTS idx_resolve_errors_run ON resolve_errors (run_id);
    `);
  }

  public beginRun(
    data: Omit<AnalysisRunRow, "finished_at"> & { finished_at?: string | null },
  ) {
    this.db
      .prepare(
        `
        INSERT OR REPLACE INTO analysis_runs (id, package_id, src_dir, status, started_at, finished_at)
        VALUES (@id, @package_id, @src_dir, @status, @started_at, @finished_at)
      `,
      )
      .run({
        ...data,
        finished_at: data.finished_at ?? null,
      });
  }

  public finishRun(
    runId: string,
    status: string,
    finishedAt: string = new Date().toISOString(),
  ) {
    this.db
      .prepare(
        "UPDATE analysis_runs SET status = ?, finished_at = ? WHERE id = ?",
      )
      .run(status, finishedAt, runId);
  }

  public markFileStatus(data: {
    id: string;
    run_id: string;
    package_id?: string | null;
    file_path: string;
    status: FileRunStatus;
    started_at: string;
    finished_at?: string | null;
    attempt?: number;
    file_hash?: string | null;
    fingerprint?: string | null;
  }) {
    this.db
      .prepare(
        `
        INSERT OR REPLACE INTO file_run_status
        (id, run_id, package_id, file_path, status, started_at, finished_at, attempt, file_hash, fingerprint)
        VALUES (@id, @run_id, @package_id, @file_path, @status, @started_at, @finished_at, @attempt, @file_hash, @fingerprint)
      `,
      )
      .run({
        ...data,
        package_id: data.package_id ?? null,
        finished_at: data.finished_at ?? null,
        attempt: data.attempt ?? 1,
        file_hash: data.file_hash ?? null,
        fingerprint: data.fingerprint ?? null,
      });
  }

  public recordFileAnalysisError(
    data: Omit<FileAnalysisErrorRow, "created_at"> & { created_at?: string },
  ) {
    this.db
      .prepare(
        `
        INSERT INTO file_analysis_errors
        (id, run_id, package_id, file_path, stage, error_code, message, line, column, stack, parser, file_hash, fingerprint, created_at)
        VALUES (@id, @run_id, @package_id, @file_path, @stage, @error_code, @message, @line, @column, @stack, @parser, @file_hash, @fingerprint, @created_at)
      `,
      )
      .run({
        ...data,
        package_id: data.package_id ?? null,
        error_code: data.error_code ?? null,
        line: data.line ?? null,
        column: data.column ?? null,
        stack: data.stack ?? null,
        parser: data.parser ?? null,
        file_hash: data.file_hash ?? null,
        fingerprint: data.fingerprint ?? null,
        created_at: data.created_at ?? new Date().toISOString(),
      });
  }

  public recordResolveError(
    data: Omit<ResolveErrorRow, "created_at"> & { created_at?: string },
  ) {
    this.db
      .prepare(
        `
        INSERT OR IGNORE INTO resolve_errors
        (id, run_id, package_id, file_path, scope_id, entity_id, relation_kind, source_name, source_module, target_hint, resolver_stage, message, loc_line, loc_column, retry_count, created_at)
        VALUES (@id, @run_id, @package_id, @file_path, @scope_id, @entity_id, @relation_kind, @source_name, @source_module, @target_hint, @resolver_stage, @message, @loc_line, @loc_column, @retry_count, @created_at)
      `,
      )
      .run({
        ...data,
        package_id: data.package_id ?? null,
        scope_id: data.scope_id ?? null,
        entity_id: data.entity_id ?? null,
        source_name: data.source_name ?? null,
        source_module: data.source_module ?? null,
        target_hint: data.target_hint ?? null,
        loc_line: data.loc_line ?? null,
        loc_column: data.loc_column ?? null,
        retry_count: data.retry_count ?? 0,
        created_at: data.created_at ?? new Date().toISOString(),
      });
  }

  public getLatestSuccessfulFileResult(
    filePath: string,
  ): ComponentFile | undefined {
    return this.loadFileResults(filePath);
  }

  public getFileErrorsForRun(runId: string, filePath?: string) {
    const sql = filePath
      ? "SELECT * FROM file_analysis_errors WHERE run_id = ? AND file_path = ?"
      : "SELECT * FROM file_analysis_errors WHERE run_id = ?";
    return this.db
      .prepare(sql)
      .all(
        ...(filePath ? [runId, filePath] : [runId]),
      ) as FileAnalysisErrorRow[];
  }

  public getResolveErrorsForRun(runId: string) {
    return this.db
      .prepare("SELECT * FROM resolve_errors WHERE run_id = ?")
      .all(runId) as ResolveErrorRow[];
  }

  public insertPackage(data: PackageRow) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO packages (id, name, version, path)
      VALUES (@id, @name, @version, @path)
    `);
    stmt.run(data);
  }

  public insertPackageDependency(data: {
    package_id: string;
    dependency_name: string;
    dependency_version: string;
    is_dev: boolean;
  }) {
    const stmt = this.db.prepare(`
      INSERT INTO package_dependencies (package_id, dependency_name, dependency_version, is_dev)
      VALUES (@package_id, @dependency_name, @dependency_version, @is_dev)
    `);
    stmt.run({
      package_id: data.package_id,
      dependency_name: data.dependency_name,
      dependency_version: data.dependency_version,
      is_dev: data.is_dev ? 1 : 0,
    });
  }

  public clearPackageDependencies(packageId: string) {
    this.db
      .prepare("DELETE FROM package_dependencies WHERE package_id = ?")
      .run(packageId);
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

  public saveFileResults(fileData: FileResultWithPackage) {
    const transaction = this.db.transaction((data: FileResultWithPackage) => {
      // 1. Insert/Update file
      this.db
        .prepare(
          `
        INSERT OR REPLACE INTO files (path, package_id, hash, fingerprint, default_export, star_exports_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
        )
        .run(
          data.path,
          data.package_id || null,
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
          "DELETE FROM relations WHERE json_extract(data_json, '$.filePath') = ?",
        )
        .run(data.path);
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

      const blockScopes = new Map<string, ComponentFileBlockScope>();
      for (const blockScope of data.blockScopes || []) {
        blockScopes.set(blockScope.id, blockScope);
      }
      for (const blockScope of data.blockScopes || []) {
        this.insertScope({
          id: blockScope.id,
          file_id: fileId,
          parent_id: blockScope.parentId || moduleScopeId,
          kind: "block",
          data_json: JSON.stringify(blockScope.scope),
        });
      }

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
        let effectiveScopeId = currentScopeId;
        let matchedScopeId: string | undefined;
        let matchedSpan = Number.MAX_SAFE_INTEGER;
        for (const blockScope of blockScopes.values()) {
          if (blockScope.parentId !== currentScopeId) continue;
          const { start, end } = blockScope.scope;
          const inScope =
            (v.loc.line > start.line ||
              (v.loc.line === start.line && v.loc.column >= start.column)) &&
            (v.loc.line < end.line ||
              (v.loc.line === end.line && v.loc.column <= end.column));
          if (!inScope) continue;

          const span =
            (end.line - start.line) * 10_000 + (end.column - start.column);
          if (span < matchedSpan) {
            matchedSpan = span;
            matchedScopeId = blockScope.id;
          }
        }
        if (matchedScopeId) {
          effectiveScopeId = matchedScopeId;
        }

        const nameStr = getVariableNameKey(v.name);
        const scope = "scope" in v ? v.scope : undefined;

        this.insertEntity({
          id: v.id,
          scope_id: effectiveScopeId,
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
            scope_id: effectiveScopeId,
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

        // If it's a function/jsx/class, it has its own scope
        if (
          (v.type === "function" || v.type === "jsx" || v.type === "class") &&
          ("var" in v || "children" in v)
        ) {
          const newScopeId = `scope:block:${v.id}`;
          this.insertScope({
            id: newScopeId,
            file_id: fileId,
            parent_id: effectiveScopeId,
            kind: "block",
            entity_id: v.id,
            data_json: scope ? JSON.stringify(scope) : null,
          });

          if ("var" in v) {
            for (const childVar of Object.values(v.var || {})) {
              insertVariable(childVar, newScopeId, v.id);
            }
          }

          if (
            (v.kind === "component" || v.kind === "hook") &&
            "props" in v &&
            Array.isArray(v.props)
          ) {
            const insertProp = (
              prop: (typeof v.props)[number],
              pathSegments: string[] = [],
            ) => {
              this.insertEntity({
                id: prop.id,
                scope_id: newScopeId,
                kind: "prop",
                name: prop.name,
                type: "data",
                line: prop.loc?.line ?? null,
                column: prop.loc?.column ?? null,
                data_json: JSON.stringify({
                  type: prop.type,
                  kind: prop.kind,
                  defaultValue: prop.defaultValue,
                }),
              });

              this.insertSymbol({
                id: `symbol:${prop.id}`,
                entity_id: prop.id,
                scope_id: newScopeId,
                name: prop.name,
                path:
                  pathSegments.length > 0 ? JSON.stringify(pathSegments) : null,
              });

              for (const childProp of prop.props || []) {
                insertProp(childProp, [...pathSegments, childProp.name]);
              }
            };

            for (const prop of v.props) {
              insertProp(prop);
            }
          }

          if ("children" in v) {
            for (const render of Object.values(v.children || {})) {
              if (!render.parentId) {
                insertRender(render, v.id, newScopeId);
              }
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

      // 8. Insert persisted usage relations for this file
      for (const relation of data.relations || []) {
        this.db
          .prepare(
            "INSERT OR REPLACE INTO relations (from_id, to_id, kind, line, column, data_json) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .run(
            relation.from_id,
            relation.to_id,
            relation.kind,
            relation.line ?? 0,
            relation.column ?? 0,
            relation.data_json ? JSON.stringify(relation.data_json) : null,
          );
      }
    });

    transaction(fileData);
  }

  public saveFileResultsForRun(
    runId: string,
    fileData: FileResultWithPackage,
    packageId?: string,
  ) {
    this.saveFileResults(fileData);
    this.markFileStatus({
      id: `${runId}:${fileData.path}`,
      run_id: runId,
      package_id: packageId ?? fileData.package_id ?? null,
      file_path: fileData.path,
      status: "persisted",
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      file_hash: fileData.hash,
      fingerprint: fileData.fingerPrint,
    });
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
      if (["import", "type", "prop"].includes(e.kind)) continue;

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

      if (e.type === "function" || e.type === "class") {
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
    const usageRelations = this.db
      .prepare(
        `
      SELECT * FROM relations
      WHERE json_extract(data_json, '$.filePath') = ?
    `,
      )
      .all(filePath) as RelationRow[];

    for (const rel of relations) {
      const parent = varMap.get(rel.from_id);
      const child = varMap.get(rel.to_id);
      if (
        parent &&
        child &&
        (parent.type === "function" || parent.type === "class") &&
        parent.var
      ) {
        parent.var[child.id] = child;
      }
    }

    result.relations = usageRelations.map((rel) => ({
      from_id: rel.from_id,
      to_id: rel.to_id,
      kind: rel.kind,
      line: rel.line,
      column: rel.column,
      data_json: rel.data_json ? JSON.parse(rel.data_json) : null,
    }));

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
