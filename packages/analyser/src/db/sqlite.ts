import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import type { 
  ComponentFileVar, 
  ComponentInfoRender, 
  VariableName,
  VariableLoc
} from "shared";

export class SqliteDB {
  private db: Database.Database;

  constructor(dbPath: string) {
    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('foreign_keys = OFF');
    this.initSchema();
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY,
        hash TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS symbols (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        file TEXT NOT NULL,
        line INTEGER NOT NULL,
        column INTEGER NOT NULL,
        kind TEXT NOT NULL,
        type TEXT NOT NULL,
        props_json TEXT,
        return_json TEXT,
        FOREIGN KEY (file) REFERENCES files (path) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS renders (
        instance_id TEXT PRIMARY KEY,
        symbol_id TEXT,
        tag TEXT NOT NULL,
        file TEXT NOT NULL,
        line INTEGER NOT NULL,
        column INTEGER NOT NULL,
        parent_instance_id TEXT,
        scope_symbol_id TEXT,
        FOREIGN KEY (file) REFERENCES files (path) ON DELETE CASCADE,
        FOREIGN KEY (scope_symbol_id) REFERENCES symbols (id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS edges (
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        label TEXT NOT NULL,
        PRIMARY KEY (from_id, to_id, label)
      );

      CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols (name);
      CREATE INDEX IF NOT EXISTS idx_renders_tag ON renders (tag);
      CREATE INDEX IF NOT EXISTS idx_renders_scope ON renders (scope_symbol_id);
    `);
  }

  public clearFile(filePath: string) {
    this.db.prepare("DELETE FROM files WHERE path = ?").run(filePath);
    this.db.prepare("DELETE FROM symbols WHERE file = ?").run(filePath);
    this.db.prepare("DELETE FROM renders WHERE file = ?").run(filePath);
  }

  public addFile(filePath: string, hash: string) {
    this.db.prepare("INSERT OR REPLACE INTO files (path, hash) VALUES (?, ?)")
      .run(filePath, hash);
  }

  public addSymbol(symbol: ComponentFileVar & { file: string }) {
    const name = typeof symbol.name === 'string' ? symbol.name : (symbol.name as any).name || 'unknown';
    
    this.db.prepare(`
      INSERT OR REPLACE INTO symbols 
      (id, name, file, line, column, kind, type, props_json, return_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      symbol.id,
      name,
      symbol.file,
      symbol.loc.line,
      symbol.loc.column,
      symbol.kind,
      symbol.type,
      JSON.stringify((symbol as any).props || []),
      JSON.stringify((symbol as any).return || null)
    );
  }

  public addRender(render: ComponentInfoRender & { 
    file: string, 
    scope_symbol_id: string,
    parent_instance_id: string | undefined
  }) {
    this.db.prepare(`
      INSERT OR REPLACE INTO renders 
      (instance_id, symbol_id, tag, file, line, column, parent_instance_id, scope_symbol_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      render.instanceId,
      render.id, // This is srcId in the analyser
      render.tag,
      render.file,
      render.loc.line,
      render.loc.column,
      render.parent_instance_id || null,
      render.scope_symbol_id
    );
  }

  public addEdge(fromId: string, toId: string, label: string) {
    if (!fromId || !toId) return;
    this.db.prepare("INSERT OR IGNORE INTO edges (from_id, to_id, label) VALUES (?, ?, ?)")
      .run(fromId, toId, label);
  }

  public close() {
    this.db.close();
  }
}
