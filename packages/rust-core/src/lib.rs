use rusqlite::Connection;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PackageRow {
    pub id: String,
    pub name: String,
    pub version: String,
    pub path: String,
}

pub struct FileRow {
    pub id: i32,
    pub path: String,
    pub package_id: Option<String>,
    pub entry_point: Option<String>,
}

pub struct EntityRow {
    pub id: String,
    pub scope_id: String,
    pub kind: String,
    pub name: Option<String>,
    pub item_type: Option<String>,
    pub line: Option<i32>,
    pub column: Option<i32>,
    pub data_json: Option<String>,
}

pub struct SymbolRow {
    pub id: String,
    pub entity_id: String,
    pub scope_id: String,
    pub name: String,
    pub path: Option<String>,
    pub is_alias: bool,
}

pub struct ScopeRow {
    pub id: String,
    pub file_id: i32,
    pub parent_id: Option<String>,
    pub kind: String,
    pub entity_id: Option<String>,
    pub data_json: Option<String>,
}

pub struct RelationRow {
    pub from_id: String,
    pub to_id: String,
    pub kind: String,
    pub data_json: Option<String>,
}

pub struct RenderRow {
    pub id: String,
    pub file_id: i32,
    pub parent_entity_id: String,
    pub parent_render_id: Option<String>,
    pub symbol_id: Option<String>,
    pub tag: String,
    pub kind: String,
    pub line: Option<i32>,
    pub column: Option<i32>,
    pub data_json: Option<String>,
}

pub struct FileInfo {
    pub path: String,
    pub package_id: Option<String>,
    pub project_path: Option<String>,
    pub entry_point: Option<String>,
}

/// Create all source-data tables matching the row structs defined above.
/// Safe to call multiple times (all statements use IF NOT EXISTS).
pub fn init_data_tables(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS packages (id TEXT PRIMARY KEY, name TEXT NOT NULL, version TEXT, path TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS files (id INTEGER PRIMARY KEY, path TEXT UNIQUE NOT NULL, package_id TEXT, hash TEXT NOT NULL, fingerprint TEXT NOT NULL, default_export TEXT, star_exports_json TEXT, entry_point TEXT);
         CREATE TABLE IF NOT EXISTS scopes (id TEXT PRIMARY KEY, file_id INTEGER NOT NULL, parent_id TEXT, kind TEXT NOT NULL, entity_id TEXT, data_json TEXT);
         CREATE TABLE IF NOT EXISTS entities (id TEXT PRIMARY KEY, scope_id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT, type TEXT, line INTEGER, column INTEGER, end_line INTEGER, end_column INTEGER, declaration_kind TEXT, data_json TEXT);
         CREATE TABLE IF NOT EXISTS symbols (id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, scope_id TEXT NOT NULL, name TEXT NOT NULL, path TEXT, is_alias BOOLEAN DEFAULT 0, has_default BOOLEAN DEFAULT 0, data_json TEXT);
         CREATE TABLE IF NOT EXISTS renders (id TEXT PRIMARY KEY, file_id INTEGER NOT NULL, parent_entity_id TEXT NOT NULL, parent_render_id TEXT, render_index INTEGER NOT NULL, tag TEXT NOT NULL, symbol_id TEXT, line INTEGER, column INTEGER, kind TEXT NOT NULL, data_json TEXT);
         CREATE TABLE IF NOT EXISTS exports (id TEXT PRIMARY KEY, scope_id TEXT NOT NULL, symbol_id TEXT, entity_id TEXT, name TEXT, is_default BOOLEAN DEFAULT 0);
         CREATE TABLE IF NOT EXISTS relations (from_id TEXT NOT NULL, to_id TEXT NOT NULL, kind TEXT NOT NULL, line INTEGER, column INTEGER, data_json TEXT, PRIMARY KEY (from_id, to_id, kind, line, column));"
    )
}

/// Create all graph-view output tables matching the out_* row structs.
/// Safe to call multiple times (all statements use IF NOT EXISTS).
pub fn init_output_tables(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS out_nodes (id TEXT PRIMARY KEY, name TEXT, type TEXT, combo_id TEXT, color TEXT, radius REAL, display_name TEXT, git_status TEXT, meta_json TEXT);
         CREATE TABLE IF NOT EXISTS out_edges (id TEXT PRIMARY KEY, source TEXT, target TEXT, name TEXT, kind TEXT, category TEXT, meta_json TEXT);
         CREATE TABLE IF NOT EXISTS out_combos (id TEXT PRIMARY KEY, name TEXT, type TEXT, parent_id TEXT, color TEXT, radius REAL, collapsed INTEGER, display_name TEXT, git_status TEXT, meta_json TEXT);
         CREATE TABLE IF NOT EXISTS out_details (id TEXT PRIMARY KEY, file_name TEXT, project_path TEXT, line INTEGER, \"column\" INTEGER, data_json TEXT);"
    )
}

pub fn table_exists(conn: &Connection, name: &str) -> bool {
    let sql = "SELECT 1 FROM sqlite_master WHERE name = ?1 AND type IN ('table', 'view')
               UNION ALL
               SELECT 1 FROM sqlite_temp_master WHERE name = ?1 AND type IN ('table', 'view')";
    conn.query_row(sql, [name], |_| Ok(())).is_ok()
}
