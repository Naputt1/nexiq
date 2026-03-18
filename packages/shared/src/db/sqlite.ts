import type { Database } from "better-sqlite3";
import type {
  FileRow,
  EntityRow,
  RelationRow,
  ScopeRow,
  SymbolRow,
  RenderRow,
  ExportRow,
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

    return {
      files,
      entities,
      scopes,
      symbols,
      renders,
      exports,
      relations,
    };
  }

  public close() {
    this.db.close();
  }
}
