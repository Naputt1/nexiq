#[macro_use]
extern crate napi_derive;

use napi::bindgen_prelude::*;
use rusqlite::{params, Connection};
use std::collections::{HashMap, HashSet};

#[napi(object)]
pub struct TaskContext {
    pub project_root: String,
    pub view_type: String,
    pub cache_db_path: Option<String>,
}

struct PackageRow {
    id: String,
    name: String,
    version: String,
    path: String,
}
struct FileRow {
    id: i32,
    path: String,
    package_id: Option<String>,
}
struct EntityRow {
    id: String,
    scope_id: String,
    kind: String,
    name: Option<String>,
    item_type: Option<String>,
    line: Option<i32>,
    column: Option<i32>,
    data_json: Option<String>,
}
struct SymbolRow {
    id: String,
    entity_id: String,
    scope_id: String,
    name: String,
    path: Option<String>,
}
struct ScopeRow {
    id: String,
    file_id: i32,
    parent_id: Option<String>,
    kind: String,
    entity_id: Option<String>,
}
struct RelationRow {
    from_id: String,
    to_id: String,
    kind: String,
    data_json: Option<String>,
}
struct FileInfo {
    path: String,
    package_id: Option<String>,
    project_path: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(i8)]
pub enum InternalItemType {
    Package = 0,
    Scope = 1,
    Component = 2,
    Hook = 3,
    State = 4,
    Memo = 5,
    Callback = 6,
    Ref = 7,
    Effect = 8,
    Prop = 9,
    Render = 10,
    RenderGroup = 11,
    SourceGroup = 12,
    PathGroup = 13,
}

struct LocalNode {
    id: String,
    item_type: InternalItemType,
    name: String,
    display_name: String,
    combo_id: Option<String>,
    color: Option<String>,
    radius: Option<f32>,
}
struct LocalCombo {
    id: String,
    item_type: InternalItemType,
    name: String,
    display_name: String,
    parent_id: Option<String>,
    color: Option<String>,
    radius: Option<f32>,
    collapsed: bool,
}
struct LocalEdge {
    id: String,
    source: String,
    target: String,
    name: String,
    kind: String,
    category: String,
}
struct LocalDetail {
    id: String,
    file_name: Option<String>,
    project_path: Option<String>,
    line: i32,
    column: i32,
    data_json: Option<String>,
}

fn map_item_type(kind: &str) -> InternalItemType {
    match kind {
        "package" => InternalItemType::Package,
        "scope" => InternalItemType::Scope,
        "component" | "function" | "class" => InternalItemType::Component,
        "hook" => InternalItemType::Hook,
        "state" => InternalItemType::State,
        "memo" => InternalItemType::Memo,
        "callback" => InternalItemType::Callback,
        "ref" => InternalItemType::Ref,
        "effect" => InternalItemType::Effect,
        "prop" => InternalItemType::Prop,
        "render" => InternalItemType::Render,
        "render-group" => InternalItemType::RenderGroup,
        "source-group" => InternalItemType::SourceGroup,
        "path-group" => InternalItemType::PathGroup,
        _ => InternalItemType::Scope,
    }
}

fn table_exists(conn: &Connection, table_name: &str) -> bool {
    conn.query_row(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?1",
        [table_name],
        |_| Ok(()),
    )
    .is_ok()
}

#[napi]
pub fn run_component_task_sqlite(context: TaskContext) -> Result<Buffer> {
    let cache_db_path = context.cache_db_path.ok_or_else(|| {
        Error::from_reason("cache_db_path is required for native Rust task execution")
    })?;

    // 1. Open an empty in-memory connection
    let conn = Connection::open_in_memory()
        .map_err(|e| Error::from_reason(format!("Failed to open in-memory SQLite: {}", e)))?;

    // 2. Attach the cache database read-only to avoid loading it into memory
    conn.execute("ATTACH DATABASE ?1 AS source", params![cache_db_path])
        .map_err(|e| Error::from_reason(format!("Failed to attach cache database: {}", e)))?;

    // 3. Create TEMP views to map the attached 'source' schema into the default namespace,
    //    meaning existing SQL queries can execute seamlessly without prefix changes.
    let mut stmt = conn
        .prepare("SELECT name FROM source.sqlite_master WHERE type IN ('table', 'view')")
        .map_err(|e| Error::from_reason(format!("Failed to query schema: {}", e)))?;
    let tables: Vec<String> = stmt
        .query_map([], |row| row.get(0))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    for table in tables {
        if !table.starts_with("sqlite_") && !table.starts_with("out_") {
            let create_view_sql = format!(
                "CREATE TEMP VIEW \"{}\" AS SELECT * FROM source.\"{}\"",
                table, table
            );
            conn.execute(&create_view_sql, []).map_err(|e| {
                Error::from_reason(format!("Failed to create alias view {}: {}", table, e))
            })?;
        }
    }

    // 2. Ensure output tables exist (though wrapper should have done it)
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS out_nodes (id TEXT PRIMARY KEY, name TEXT, type TEXT, combo_id TEXT, color TEXT, radius REAL, display_name TEXT, meta_json TEXT);
         CREATE TABLE IF NOT EXISTS out_edges (id TEXT PRIMARY KEY, source TEXT, target TEXT, name TEXT, kind TEXT, category TEXT, meta_json TEXT);
         CREATE TABLE IF NOT EXISTS out_combos (id TEXT PRIMARY KEY, name TEXT, type TEXT, parent_id TEXT, color TEXT, radius REAL, collapsed INTEGER, display_name TEXT, meta_json TEXT);
         CREATE TABLE IF NOT EXISTS out_details (id TEXT PRIMARY KEY, file_name TEXT, project_path TEXT, line INTEGER, \"column\" INTEGER, data_json TEXT);"
    ).map_err(|e| Error::from_reason(format!("Failed to create output tables: {}", e)))?;

    // 3. Run logic (simplified version of the previous logic but writing to DB)
    // Fetch necessary data
    let files: Vec<FileRow> = conn
        .prepare("SELECT id, path, package_id FROM files")
        .unwrap()
        .query_map([], |row| {
            Ok(FileRow {
                id: row.get(0)?,
                path: row.get(1)?,
                package_id: row.get(2)?,
            })
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    let entities: Vec<EntityRow> = conn
        .prepare("SELECT id, scope_id, kind, name, type, line, \"column\", data_json FROM entities")
        .unwrap()
        .query_map([], |row| {
            Ok(EntityRow {
                id: row.get(0)?,
                scope_id: row.get(1)?,
                kind: row.get(2)?,
                name: row.get(3)?,
                item_type: row.get(4)?,
                line: row.get(5)?,
                column: row.get(6)?,
                data_json: row.get(7)?,
            })
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    let symbols: Vec<SymbolRow> = conn
        .prepare("SELECT id, entity_id, scope_id, name, path FROM symbols")
        .unwrap()
        .query_map([], |row| {
            Ok(SymbolRow {
                id: row.get(0)?,
                entity_id: row.get(1)?,
                scope_id: row.get(2)?,
                name: row.get(3)?,
                path: row.get(4)?,
            })
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    let scopes: Vec<ScopeRow> = conn
        .prepare("SELECT id, file_id, parent_id, kind, entity_id FROM scopes")
        .unwrap()
        .query_map([], |row| {
            Ok(ScopeRow {
                id: row.get(0)?,
                file_id: row.get(1)?,
                parent_id: row.get(2)?,
                kind: row.get(3)?,
                entity_id: row.get(4)?,
            })
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    let relations: Vec<RelationRow> = conn
        .prepare("SELECT from_id, to_id, kind, data_json FROM relations")
        .unwrap()
        .query_map([], |row| {
            Ok(RelationRow {
                from_id: row.get(0)?,
                to_id: row.get(1)?,
                kind: row.get(2)?,
                data_json: row.get(3)?,
            })
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    let packages: Vec<PackageRow> = conn
        .prepare("SELECT id, name, version, path FROM packages")
        .unwrap()
        .query_map([], |row| {
            Ok(PackageRow {
                id: row.get(0)?,
                name: row.get(1)?,
                version: row.get(2)?,
                path: row.get(3)?,
            })
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    // Map logical structures (same logic as before)
    let package_path_map: HashMap<String, String> = packages
        .iter()
        .map(|p| (p.id.clone(), p.path.clone()))
        .collect();
    let file_info_map: HashMap<i32, FileInfo> = files
        .iter()
        .map(|f| {
            (
                f.id,
                FileInfo {
                    path: f.path.clone(),
                    package_id: f.package_id.clone(),
                    project_path: f
                        .package_id
                        .as_ref()
                        .and_then(|id| package_path_map.get(id).cloned()),
                },
            )
        })
        .collect();

    let use_package_combos = packages.len() > 1;
    let mut added_combos = HashSet::new();
    let mut added_nodes = HashSet::new();

    // Helper to insert results
    let mut ins_node = conn.prepare("INSERT OR REPLACE INTO out_nodes (id, name, type, combo_id, color, radius, display_name, meta_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)").unwrap();
    let mut ins_combo = conn.prepare("INSERT OR REPLACE INTO out_combos (id, name, type, parent_id, color, radius, collapsed, display_name, meta_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)").unwrap();
    let mut ins_edge = conn.prepare("INSERT OR REPLACE INTO out_edges (id, source, target, name, kind, category, meta_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)").unwrap();
    let mut ins_detail = conn.prepare("INSERT OR REPLACE INTO out_details (id, file_name, project_path, line, \"column\", data_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6)").unwrap();

    // 1. Scopes -> Combos
    for scope in &scopes {
        if scope.kind == "module" {
            continue;
        }
        let mut parent_id = scope.parent_id.clone().and_then(|pid| {
            scopes
                .iter()
                .find(|s| s.id == pid && s.kind != "module")
                .map(|_| pid)
        });
        if parent_id.is_none() && use_package_combos {
            if let Some(fi) = file_info_map.get(&scope.file_id) {
                if let Some(pkg_id) = &fi.package_id {
                    let pkg_cid = format!("package:{}", pkg_id);
                    parent_id = Some(pkg_cid.clone());
                    if !added_combos.contains(&pkg_cid) {
                        if let Some(pkg) = packages.iter().find(|p| p.id == *pkg_id) {
                            ins_combo
                                .execute(params![
                                    pkg_cid,
                                    pkg.name,
                                    "package",
                                    None::<String>,
                                    None::<String>,
                                    24.0,
                                    1,
                                    pkg.name,
                                    None::<String>
                                ])
                                .unwrap();
                            added_combos.insert(pkg_cid);
                        }
                    }
                }
            }
        }
        ins_combo
            .execute(params![
                scope.id,
                scope.kind,
                "scope",
                parent_id,
                None::<String>,
                18.0,
                1,
                None::<String>,
                None::<String>
            ])
            .unwrap();
        added_combos.insert(scope.id.clone());
    }

    // 2. Symbols -> Nodes/Combos
    for symbol in &symbols {
        if symbol.name.starts_with("jsx@") {
            continue;
        }
        let entity = entities.iter().find(|e| e.id == symbol.entity_id);
        if entity.is_none() || entity.unwrap().kind == "import" {
            continue;
        }
        let entity = entity.unwrap();

        let scope = scopes.iter().find(|s| s.id == symbol.scope_id);
        let file_info = scope.and_then(|s| file_info_map.get(&s.file_id));
        let block_scope = scopes
            .iter()
            .find(|s| s.entity_id == Some(entity.id.clone()));

        if let Some(bs) = block_scope {
            // Update existing scope combo
            conn.execute(
                "UPDATE out_combos SET name = ?1, display_name = ?2, type = ?3 WHERE id = ?4",
                params![symbol.name, symbol.name, entity.kind, bs.id],
            )
            .unwrap();
            ins_detail
                .execute(params![
                    bs.id,
                    file_info.map(|f| f.path.clone()),
                    file_info.and_then(|f| f.project_path.clone()),
                    entity.line.unwrap_or(0),
                    entity.column.unwrap_or(0),
                    entity.data_json
                ])
                .unwrap();
        } else {
            let mut parent_id = scope
                .filter(|s| s.kind != "module")
                .map(|_| symbol.scope_id.clone());
            if parent_id.is_none() && use_package_combos {
                if let Some(fi) = file_info.as_ref() {
                    if let Some(pkg_id) = &fi.package_id {
                        parent_id = Some(format!("package:{}", pkg_id));
                    }
                }
            }
            ins_node
                .execute(params![
                    symbol.id,
                    symbol.name,
                    entity.kind,
                    parent_id,
                    None::<String>,
                    20.0,
                    symbol.name,
                    entity.data_json
                ])
                .unwrap();
            ins_detail
                .execute(params![
                    symbol.id,
                    file_info.map(|f| f.path.clone()),
                    file_info.and_then(|f| f.project_path.clone()),
                    entity.line.unwrap_or(0),
                    entity.column.unwrap_or(0),
                    entity.data_json
                ])
                .unwrap();
            added_nodes.insert(symbol.id.clone());
        }
    }

    // 3. Relations -> Edges
    for rel in &relations {
        if rel.kind == "parent-child" {
            continue;
        }
        ins_edge
            .execute(params![
                format!("{}-{}-{}", rel.from_id, rel.to_id, rel.kind),
                rel.from_id,
                rel.to_id,
                rel.kind,
                rel.kind,
                rel.kind,
                rel.data_json
            ])
            .unwrap();
    }

    // 4. Serialize back to buffer
    let mut size: i64 = 0;
    unsafe {
        let db = conn.handle();
        let ptr =
            rusqlite::ffi::sqlite3_serialize(db, b"main\0".as_ptr() as *const i8, &mut size, 0u32);
        if ptr.is_null() {
            return Err(Error::from_reason("sqlite3_serialize failed"));
        }
        let result_vec = std::slice::from_raw_parts(ptr, size as usize).to_vec();
        rusqlite::ffi::sqlite3_free(ptr as *mut std::ffi::c_void);
        Ok(Buffer::from(result_vec))
    }
}
