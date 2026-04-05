import type { Database } from "better-sqlite3";
import type {
  AnalysisRunRow,
  FileRunStatusRow,
  FileAnalysisErrorRow,
  ResolveErrorRow,
  FileRow,
  EntityRow,
  RelationRow,
  ScopeRow,
  SymbolRow,
  RenderRow,
  ExportRow,
  PackageRow,
  PackageDependencyRow,
} from "../index.js";

export class SqliteDB {
  public db: Database;

  constructor(db: Database) {
    this.db = db;
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
  }

  public getFileByPath(filePath: string): FileRow | undefined {
    return this.db
      .prepare("SELECT * FROM files WHERE path = ?")
      .get(filePath) as FileRow | undefined;
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

  public getAllData() {
    const packages = this.db
      .prepare("SELECT * FROM packages")
      .all() as PackageRow[];
    const package_dependencies = this.db
      .prepare("SELECT * FROM package_dependencies")
      .all() as PackageDependencyRow[];
    const files = this.db.prepare("SELECT * FROM files").all() as FileRow[];
    const entities = this.db
      .prepare("SELECT * FROM entities")
      .all() as EntityRow[];
    const scopes = this.db.prepare("SELECT * FROM scopes").all() as ScopeRow[];
    const symbols = this.db
      .prepare("SELECT * FROM symbols")
      .all() as SymbolRow[];
    const renders = this.db
      .prepare("SELECT * FROM renders")
      .all() as RenderRow[];
    const exports = this.db
      .prepare("SELECT * FROM exports")
      .all() as ExportRow[];
    const relations = this.db
      .prepare("SELECT * FROM relations")
      .all() as RelationRow[];
    const analysis_runs = this.db
      .prepare("SELECT * FROM analysis_runs")
      .all() as AnalysisRunRow[];
    const file_run_status = this.db
      .prepare("SELECT * FROM file_run_status")
      .all() as FileRunStatusRow[];
    const file_analysis_errors = this.db
      .prepare("SELECT * FROM file_analysis_errors")
      .all() as FileAnalysisErrorRow[];
    const resolve_errors = this.db
      .prepare("SELECT * FROM resolve_errors")
      .all() as ResolveErrorRow[];

    return {
      packages,
      package_dependencies,
      files,
      entities,
      scopes,
      symbols,
      renders,
      exports,
      relations,
      analysis_runs,
      file_run_status,
      file_analysis_errors,
      resolve_errors,
    };
  }

  public close() {
    this.db.close();
  }
}
