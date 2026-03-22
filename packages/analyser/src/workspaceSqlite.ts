import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { SqliteDB as BaseSqliteDB } from "@nexiq/shared/db";

export class WorkspaceSqliteDB extends BaseSqliteDB {
  constructor(dbPath: string, options: { readonly?: boolean } = {}) {
    if (!options.readonly) {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    super(new Database(dbPath, options));
    this.initSchema();
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_packages (
        package_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version TEXT,
        path TEXT NOT NULL,
        db_path TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workspace_runs (
        id TEXT PRIMARY KEY,
        root_dir TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT
      );

      CREATE TABLE IF NOT EXISTS package_run_summaries (
        id TEXT PRIMARY KEY,
        workspace_run_id TEXT NOT NULL,
        package_id TEXT NOT NULL,
        analysis_run_id TEXT NOT NULL,
        status TEXT NOT NULL,
        files_total INTEGER NOT NULL,
        files_succeeded INTEGER NOT NULL,
        files_failed INTEGER NOT NULL,
        resolve_errors INTEGER NOT NULL,
        FOREIGN KEY (workspace_run_id) REFERENCES workspace_runs (id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS package_relations (
        from_package_id TEXT NOT NULL,
        to_package_id TEXT NOT NULL,
        relation_kind TEXT NOT NULL,
        source_file_path TEXT,
        target_file_path TEXT,
        source_symbol TEXT,
        target_symbol TEXT,
        run_id TEXT NOT NULL,
        PRIMARY KEY (from_package_id, to_package_id, relation_kind, source_file_path, source_symbol)
      );

      CREATE TABLE IF NOT EXISTS cross_package_resolve_errors (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        from_package_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        source_name TEXT,
        source_module TEXT,
        relation_kind TEXT NOT NULL,
        message TEXT NOT NULL,
        loc_line INTEGER,
        loc_column INTEGER,
        created_at TEXT NOT NULL
      );
    `);
  }

  public beginWorkspaceRun(data: {
    id: string;
    root_dir: string;
    status: string;
    started_at: string;
  }) {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO workspace_runs (id, root_dir, status, started_at, finished_at) VALUES (?, ?, ?, ?, NULL)",
      )
      .run(data.id, data.root_dir, data.status, data.started_at);
  }

  public finishWorkspaceRun(id: string, status: string) {
    this.db
      .prepare(
        "UPDATE workspace_runs SET status = ?, finished_at = ? WHERE id = ?",
      )
      .run(status, new Date().toISOString(), id);
  }

  public upsertWorkspacePackage(data: {
    package_id: string;
    name: string;
    version?: string | undefined;
    path: string;
    db_path: string;
  }) {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO workspace_packages (package_id, name, version, path, db_path) VALUES (?, ?, ?, ?, ?)",
      )
      .run(data.package_id, data.name, data.version || null, data.path, data.db_path);
  }

  public insertPackageRunSummary(data: {
    id: string;
    workspace_run_id: string;
    package_id: string;
    analysis_run_id: string;
    status: string;
    files_total: number;
    files_succeeded: number;
    files_failed: number;
    resolve_errors: number;
  }) {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO package_run_summaries (id, workspace_run_id, package_id, analysis_run_id, status, files_total, files_succeeded, files_failed, resolve_errors) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        data.id,
        data.workspace_run_id,
        data.package_id,
        data.analysis_run_id,
        data.status,
        data.files_total,
        data.files_succeeded,
        data.files_failed,
        data.resolve_errors,
      );
  }

  public insertPackageRelation(data: {
    from_package_id: string;
    to_package_id: string;
    relation_kind: string;
    source_file_path?: string | undefined;
    target_file_path?: string | undefined;
    source_symbol?: string | undefined;
    target_symbol?: string | undefined;
    run_id: string;
  }) {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO package_relations (from_package_id, to_package_id, relation_kind, source_file_path, target_file_path, source_symbol, target_symbol, run_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        data.from_package_id,
        data.to_package_id,
        data.relation_kind,
        data.source_file_path || null,
        data.target_file_path || null,
        data.source_symbol || null,
        data.target_symbol || null,
        data.run_id,
      );
  }

  public insertCrossPackageResolveError(data: {
    id: string;
    run_id: string;
    from_package_id: string;
    file_path: string;
    source_name?: string | undefined;
    source_module?: string | undefined;
    relation_kind: string;
    message: string;
    loc_line?: number | undefined;
    loc_column?: number | undefined;
  }) {
    this.db
      .prepare(
        "INSERT INTO cross_package_resolve_errors (id, run_id, from_package_id, file_path, source_name, source_module, relation_kind, message, loc_line, loc_column, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        data.id,
        data.run_id,
        data.from_package_id,
        data.file_path,
        data.source_name || null,
        data.source_module || null,
        data.relation_kind,
        data.message,
        data.loc_line || null,
        data.loc_column || null,
        new Date().toISOString(),
      );
  }
}
