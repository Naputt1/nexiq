#[macro_use]
extern crate napi_derive;

use napi::bindgen_prelude::*;
use rusqlite::{params, Connection};
use rust_core::*;
use std::collections::{HashMap, HashSet};
use std::path::Path;

#[napi(object)]
pub struct TaskContext {
    pub project_root: String,
    pub view_type: String,
    pub cache_db_path: Option<String>,
}

#[napi]
pub fn run_component_task_sqlite(context: TaskContext) -> Result<Buffer> {
    let cache_db_path = context.cache_db_path.ok_or_else(|| {
        Error::from_reason("cache_db_path is required for native Rust task execution")
    })?;

    // 1. Open an empty in-memory connection
    let conn = Connection::open_in_memory()
        .map_err(|e| Error::from_reason(format!("Failed to open in-memory SQLite: {}", e)))?;

    // 2. Attach the cache database read-only
    conn.execute("ATTACH DATABASE ?1 AS source", params![cache_db_path])
        .map_err(|e| Error::from_reason(format!("Failed to attach cache database: {}", e)))?;

    // 3. Initialize data tables in main
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS packages (id TEXT PRIMARY KEY, name TEXT NOT NULL, version TEXT, path TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS files (id INTEGER PRIMARY KEY, path TEXT UNIQUE NOT NULL, package_id TEXT, hash TEXT NOT NULL, fingerprint TEXT NOT NULL, default_export TEXT, star_exports_json TEXT);
         CREATE TABLE IF NOT EXISTS scopes (id TEXT PRIMARY KEY, file_id INTEGER NOT NULL, parent_id TEXT, kind TEXT NOT NULL, entity_id TEXT, data_json TEXT);
         CREATE TABLE IF NOT EXISTS entities (id TEXT PRIMARY KEY, scope_id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT, type TEXT, line INTEGER, column INTEGER, end_line INTEGER, end_column INTEGER, declaration_kind TEXT, data_json TEXT);
         CREATE TABLE IF NOT EXISTS symbols (id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, scope_id TEXT NOT NULL, name TEXT NOT NULL, path TEXT, is_alias BOOLEAN DEFAULT 0, has_default BOOLEAN DEFAULT 0, data_json TEXT);
         CREATE TABLE IF NOT EXISTS renders (id TEXT PRIMARY KEY, file_id INTEGER NOT NULL, parent_entity_id TEXT NOT NULL, parent_render_id TEXT, render_index INTEGER NOT NULL, tag TEXT NOT NULL, symbol_id TEXT, line INTEGER, column INTEGER, kind TEXT NOT NULL, data_json TEXT);
         CREATE TABLE IF NOT EXISTS exports (id TEXT PRIMARY KEY, scope_id TEXT NOT NULL, symbol_id TEXT, entity_id TEXT, name TEXT, is_default BOOLEAN DEFAULT 0);
         CREATE TABLE IF NOT EXISTS relations (from_id TEXT NOT NULL, to_id TEXT NOT NULL, kind TEXT NOT NULL, line INTEGER, column INTEGER, data_json TEXT, PRIMARY KEY (from_id, to_id, kind, line, column));"
    ).map_err(|e| Error::from_reason(format!("Failed to create data tables: {}", e)))?;

    // 4. Aggregate data
    let is_monorepo = conn
        .prepare("SELECT 1 FROM source.workspace_packages")
        .is_ok();

    if is_monorepo {
        let mut stmt = conn
            .prepare(
                "SELECT package_id, path, db_path, name, version FROM source.workspace_packages",
            )
            .unwrap();
        let workspace_packages: Vec<(String, String, String, String, Option<String>)> = stmt
            .query_map([], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            })
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        for (i, (pkg_id, pkg_path, db_path, name, version)) in workspace_packages.iter().enumerate()
        {
            let offset = (i + 1) * 1000000;
            let prefix = format!("workspace:{}:", pkg_id);
            let pkg_rel = pkg_path.trim_start_matches('/').trim_end_matches('/');

            let abs_db_path = if Path::new(db_path).is_absolute() {
                db_path.clone()
            } else {
                Path::new(&context.project_root)
                    .join(db_path)
                    .to_str()
                    .unwrap()
                    .to_string()
            };

            if !Path::new(&abs_db_path).exists() {
                continue;
            }

            let pkg_alias = format!("pkg_{}", i);
            conn.execute(
                &format!("ATTACH DATABASE '{}' AS {}", abs_db_path, pkg_alias),
                [],
            )
            .unwrap();

            let path_expr = if pkg_rel.is_empty() {
                "path".to_string()
            } else {
                format!(
                    "'/{}' || CASE WHEN path LIKE '/%' THEN path ELSE '/' || path END",
                    pkg_rel
                )
            };

            conn.execute_batch(&format!("
                INSERT OR IGNORE INTO main.packages (id, name, version, path) VALUES ('{}', '{}', '{}', '{}');

                INSERT OR IGNORE INTO main.files (id, path, package_id, hash, fingerprint, default_export, star_exports_json)
                SELECT id + {}, {}, '{}', hash, fingerprint, default_export, star_exports_json FROM {}.files;

                INSERT OR IGNORE INTO main.scopes (id, file_id, parent_id, kind, entity_id, data_json)
                SELECT '{}' || id, file_id + {}, CASE WHEN parent_id IS NOT NULL THEN '{}' || parent_id ELSE NULL END, kind, CASE WHEN entity_id IS NOT NULL THEN '{}' || entity_id ELSE NULL END, data_json FROM {}.scopes;

                INSERT OR IGNORE INTO main.entities (id, scope_id, kind, name, type, line, column, end_line, end_column, declaration_kind, data_json)
                SELECT '{}' || id, '{}' || scope_id, kind, name, type, line, column, end_line, end_column, declaration_kind, data_json FROM {}.entities;

                INSERT OR IGNORE INTO main.symbols (id, entity_id, scope_id, name, path, is_alias, has_default, data_json)
                SELECT '{}' || id, '{}' || entity_id, '{}' || scope_id, name, path, is_alias, has_default, data_json FROM {}.symbols;

                INSERT OR IGNORE INTO main.renders (id, file_id, parent_entity_id, parent_render_id, tag, symbol_id, line, column, kind, data_json)
                SELECT '{}' || id, file_id + {}, '{}' || parent_entity_id, CASE WHEN parent_render_id IS NOT NULL THEN '{}' || parent_render_id ELSE NULL END, tag, CASE WHEN symbol_id IS NOT NULL THEN '{}' || symbol_id ELSE NULL END, line, column, kind, data_json FROM {}.renders;

                INSERT OR IGNORE INTO main.exports (id, scope_id, symbol_id, entity_id, name, is_default)
                SELECT '{}' || id, '{}' || scope_id, CASE WHEN symbol_id IS NOT NULL THEN '{}' || symbol_id ELSE NULL END, CASE WHEN entity_id IS NOT NULL THEN '{}' || entity_id ELSE NULL END, name, is_default FROM {}.exports;

                INSERT OR IGNORE INTO main.relations (from_id, to_id, kind, line, column, data_json)
                SELECT '{}' || from_id, '{}' || to_id, kind, line, column, data_json FROM {}.relations;
            ", 
                pkg_id, name, version.as_deref().unwrap_or("0.0.0"), pkg_path,
                offset, path_expr, pkg_id, pkg_alias,
                prefix, offset, prefix, prefix, pkg_alias,
                prefix, prefix, pkg_alias,
                prefix, prefix, prefix, pkg_alias,
                prefix, offset, prefix, prefix, prefix, pkg_alias,
                prefix, prefix, prefix, prefix, pkg_alias,
                prefix, prefix, pkg_alias
            )).unwrap();

            conn.execute(&format!("DETACH DATABASE {}", pkg_alias), [])
                .unwrap();
        }
    } else {
        // Single project: Create TEMP views to map the attached 'source' schema into the default namespace
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
    }

    // 5. Ensure output tables exist
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS out_nodes (id TEXT PRIMARY KEY, name TEXT, type TEXT, combo_id TEXT, color TEXT, radius REAL, display_name TEXT, meta_json TEXT);
         CREATE TABLE IF NOT EXISTS out_edges (id TEXT PRIMARY KEY, source TEXT, target TEXT, name TEXT, kind TEXT, category TEXT, meta_json TEXT);
         CREATE TABLE IF NOT EXISTS out_combos (id TEXT PRIMARY KEY, name TEXT, type TEXT, parent_id TEXT, color TEXT, radius REAL, collapsed INTEGER, display_name TEXT, meta_json TEXT);
         CREATE TABLE IF NOT EXISTS out_details (id TEXT PRIMARY KEY, file_name TEXT, project_path TEXT, line INTEGER, \"column\" INTEGER, data_json TEXT);"
    ).map_err(|e| Error::from_reason(format!("Failed to create output tables: {}", e)))?;

    // 6. Run logic
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
    let renders: Vec<RenderRow> = conn
        .prepare("SELECT id, file_id, parent_entity_id, parent_render_id, symbol_id, tag, line, \"column\", data_json FROM renders")
        .unwrap()
        .query_map([], |row| {
            Ok(RenderRow {
                id: row.get(0)?,
                file_id: row.get(1)?,
                parent_entity_id: row.get(2)?,
                parent_render_id: row.get(3)?,
                symbol_id: row.get(4)?,
                tag: row.get(5)?,
                line: row.get(6)?,
                column: row.get(7)?,
                data_json: row.get(8)?,
            })
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    // --- Pre-processing: Redirection Map ---
    let mut redirection_map: HashMap<String, String> = HashMap::new();
    let mut export_map: HashMap<String, HashMap<String, String>> = HashMap::new(); // Map<file_path OR package_name, Map<export_name, symbol_id>>

    // Build export map
    if table_exists(&conn, "exports") {
        let mut exp_stmt = conn.prepare("SELECT e.name, s.id, f.path, p.name FROM exports e JOIN symbols s ON e.symbol_id = s.id JOIN scopes sc ON e.scope_id = sc.id JOIN files f ON sc.file_id = f.id LEFT JOIN packages p ON f.package_id = p.id").unwrap();
        let exports_iter = exp_stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            })
            .unwrap();
        for exp in exports_iter.filter_map(|r| r.ok()) {
            let (exp_name, sym_id, file_path, pkg_name) = exp;
            export_map
                .entry(file_path)
                .or_default()
                .insert(exp_name.clone(), sym_id.clone());
            if let Some(name) = pkg_name {
                export_map.entry(name).or_default().insert(exp_name, sym_id);
            }
        }
    }

    // Build redirection map for imports
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

    for sym in &symbols {
        if let Some(entity) = entities.iter().find(|e| e.id == sym.entity_id) {
            if entity.kind == "import" {
                if let Some(dj) = &entity.data_json {
                    if let Ok(dj_json) = serde_json::from_str::<serde_json::Value>(dj) {
                        if let (Some(source), Some(imported_name)) =
                            (dj_json["source"].as_str(), dj_json["importedName"].as_str())
                        {
                            let source_path = source.to_string();
                            let mut target_sym_id = export_map
                                .get(&source_path)
                                .and_then(|m| m.get(imported_name));

                            // If not found and source is a package-relative path (starts with /), try to resolve it to root-relative
                            if target_sym_id.is_none() && source_path.starts_with('/') {
                                if let Some(scope) = scopes.iter().find(|s| s.id == sym.scope_id) {
                                    if let Some(file_info) = file_info_map.get(&scope.file_id) {
                                        if let Some(pkg_path) = &file_info.project_path {
                                            let pkg_rel = pkg_path
                                                .trim_start_matches('/')
                                                .trim_end_matches('/');
                                            if !pkg_rel.is_empty() {
                                                let resolved_path = format!(
                                                    "/{}/{}",
                                                    pkg_rel,
                                                    source_path.trim_start_matches('/')
                                                );
                                                target_sym_id = export_map
                                                    .get(&resolved_path)
                                                    .and_then(|m| m.get(imported_name));
                                            }
                                        }
                                    }
                                }
                            }

                            if let Some(sym_id) = target_sym_id {
                                redirection_map.insert(sym.id.clone(), sym_id.clone());
                            }
                        }
                    }
                }
            }
        }
    }

    let use_package_combos = packages.len() > 1;
    let mut added_combos = HashSet::new();
    let mut added_nodes = HashSet::new();

    // Helper to insert results
    let mut ins_node = conn.prepare("INSERT OR REPLACE INTO out_nodes (id, name, type, combo_id, color, radius, display_name, meta_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)").unwrap();
    let mut ins_combo = conn.prepare("INSERT OR REPLACE INTO out_combos (id, name, type, parent_id, color, radius, collapsed, display_name, meta_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)").unwrap();
    let mut ins_edge = conn.prepare("INSERT OR REPLACE INTO out_edges (id, source, target, name, kind, category, meta_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)").unwrap();
    let mut ins_detail = conn.prepare("INSERT OR REPLACE INTO out_details (id, file_name, project_path, line, \"column\", data_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6)").unwrap();

    // 0. Pre-create Package Combos if multiple packages exist
    if use_package_combos {
        for pkg in &packages {
            let pkg_cid = format!("package:{}", pkg.id);
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
                    if added_combos.contains(&pkg_cid) {
                        parent_id = Some(pkg_cid);
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

        // Skip state setters (index 1 of the state array) to avoid showing duplicate nodes
        if entity.kind == "state" {
            if let Some(path_str) = &symbol.path {
                if let Ok(path_json) = serde_json::from_str::<serde_json::Value>(path_str) {
                    if let Some(path_arr) = path_json.as_array() {
                        if !path_arr.is_empty() && path_arr[0] != "0" && path_arr[0] != 0 {
                            continue;
                        }
                    }
                }
            }
        }

        let scope = scopes.iter().find(|s| s.id == symbol.scope_id);
        let file_info = scope.and_then(|s| file_info_map.get(&s.file_id));
        let block_scope = scopes
            .iter()
            .find(|s| s.entity_id == Some(entity.id.clone()));

        let mut pc_id = if let Some(bs) = block_scope {
            // Update existing scope combo
            let combo_type = if entity.kind == "normal" {
                "variable"
            } else {
                &entity.kind
            };
            conn.execute(
                "UPDATE out_combos SET name = ?1, display_name = ?2, type = ?3 WHERE id = ?4",
                params![symbol.name, symbol.name, combo_type, bs.id],
            )
            .unwrap();
            Some(bs.id.clone())
        } else {
            let mut pid = scope
                .filter(|s| s.kind != "module")
                .map(|_| symbol.scope_id.clone());
            if pid.is_none() && use_package_combos {
                if let Some(fi) = file_info.as_ref() {
                    if let Some(pkg_id) = &fi.package_id {
                        let pkg_cid = format!("package:{}", pkg_id);
                        if added_combos.contains(&pkg_cid) {
                            pid = Some(pkg_cid);
                        }
                    }
                }
            }
            pid
        };

        // Source Combo for Hooks result
        if entity.kind == "hook" {
            let sc_id = format!("{}:source:{}", symbol.scope_id, entity.id);
            if !added_combos.contains(&sc_id) {
                ins_combo
                    .execute(params![
                        sc_id,
                        symbol.name,
                        "source-group",
                        pc_id,
                        None::<String>,
                        16.0,
                        1,
                        symbol.name,
                        None::<String>
                    ])
                    .unwrap();
                added_combos.insert(sc_id.clone());
            }
            pc_id = Some(sc_id);
        }

        // Path-based grouping (Destructuring)
        if let Some(path_str) = &symbol.path {
            if let Ok(path_json) = serde_json::from_str::<serde_json::Value>(path_str) {
                if let Some(path_arr) = path_json.as_array() {
                    let mut current_parent = pc_id.clone();
                    let mut path_prefix = if entity.kind == "hook" {
                        format!("{}:path", pc_id.as_ref().unwrap())
                    } else {
                        format!("{}:path:{}", symbol.scope_id, symbol.id)
                    };

                    for (i, seg) in path_arr.iter().enumerate() {
                        if i == path_arr.len() - 1 && entity.kind != "state" {
                            break;
                        }
                        let seg_str = match seg {
                            serde_json::Value::String(s) => s.clone(),
                            serde_json::Value::Number(n) => n.to_string(),
                            _ => continue,
                        };

                        // Skip index 0/1 for state arrays
                        if entity.kind == "state" && (seg_str == "0" || seg_str == "1") {
                            continue;
                        }

                        if i == path_arr.len() - 1 && entity.kind == "state" {
                            break;
                        }

                        let group_id = format!("{}:{}", path_prefix, seg_str);
                        if !added_combos.contains(&group_id) {
                            ins_combo
                                .execute(params![
                                    group_id,
                                    seg_str,
                                    "path-group",
                                    current_parent,
                                    None::<String>,
                                    14.0,
                                    1,
                                    seg_str,
                                    None::<String>
                                ])
                                .unwrap();
                            added_combos.insert(group_id.clone());
                        }
                        current_parent = Some(group_id.clone());
                        path_prefix = group_id;
                    }
                    pc_id = current_parent;
                }
            }
        }

        if block_scope.is_none() {
            let node_type = if entity.kind == "normal" {
                "variable"
            } else {
                &entity.kind
            };
            ins_node
                .execute(params![
                    symbol.id,
                    symbol.name,
                    node_type,
                    pc_id,
                    None::<String>,
                    20.0,
                    symbol.name,
                    entity.data_json
                ])
                .unwrap();
            added_nodes.insert(symbol.id.clone());
        }

        ins_detail
            .execute(params![
                block_scope
                    .map(|s| s.id.clone())
                    .unwrap_or(symbol.id.clone()),
                file_info.map(|f| f.path.clone()),
                file_info.and_then(|f| f.project_path.clone()),
                entity.line.unwrap_or(0),
                entity.column.unwrap_or(0),
                entity.data_json
            ])
            .unwrap();
    }

    // 3. Renders
    for render in &renders {
        let file_info = file_info_map.get(&render.file_id);
        let parent_scope = scopes
            .iter()
            .find(|s| s.entity_id == Some(render.parent_entity_id.clone()));

        let mut pc_id = render
            .parent_render_id
            .clone()
            .or(parent_scope.map(|s| s.id.clone()));

        if pc_id.is_none() && use_package_combos {
            if let Some(fi) = file_info.as_ref() {
                if let Some(pkg_id) = &fi.package_id {
                    let pkg_cid = format!("package:{}", pkg_id);
                    if added_combos.contains(&pkg_cid) {
                        pc_id = Some(pkg_cid);
                    }
                }
            }
        }

        if let Some(ps) = parent_scope {
            if render.parent_render_id.is_none() {
                let rg_id = format!("render-group-{}", ps.id);
                if !added_combos.contains(&rg_id) {
                    conn.execute(
                        "INSERT INTO out_combos (id, name, type, parent_id, color, radius, collapsed, display_name) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                        params![rg_id, "render", "render-group", ps.id, None::<String>, 18.0, 1, "render"],
                    ).unwrap();
                    added_combos.insert(rg_id.clone());
                }
                pc_id = Some(rg_id);
            }
        }

        conn.execute(
            "INSERT INTO out_combos (id, name, type, parent_id, color, radius, collapsed, display_name) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![render.id, render.tag, "render", pc_id, None::<String>, 14.0, 1, render.tag],
        ).unwrap();

        ins_detail
            .execute(params![
                render.id,
                file_info.map(|f| f.path.clone()),
                file_info.and_then(|f| f.project_path.clone()),
                render.line.unwrap_or(0),
                render.column.unwrap_or(0),
                render.data_json
            ])
            .unwrap();

        added_combos.insert(render.id.clone());
    }

    // 4. Hook Specific Nodes (Effects) and 5. Relations -> Edges
    let mut edge_map: HashMap<String, (String, String, String, i32, Vec<serde_json::Value>)> =
        HashMap::new();

    let mut add_edge_local =
        |source: &str, target: &str, kind: &str, name: &str, data: Option<&str>| {
            let s = redirection_map
                .get(source)
                .unwrap_or(&source.to_string())
                .clone();
            let t = redirection_map
                .get(target)
                .unwrap_or(&target.to_string())
                .clone();
            let e_id = format!("{}-{}-{}", s, t, kind);
            let entry = edge_map
                .entry(e_id)
                .or_insert((s, t, kind.to_string(), 0, Vec::new()));
            entry.3 += 1;
            if let Some(d) = data {
                if let Ok(j) = serde_json::from_str::<serde_json::Value>(d) {
                    entry.4.push(j);
                }
            }
        };

    // Generic Relations
    for rel in &relations {
        if rel.kind == "parent-child" {
            continue;
        }
        add_edge_local(
            &rel.from_id,
            &rel.to_id,
            &rel.kind,
            &rel.kind,
            rel.data_json.as_deref(),
        );
    }

    // Hook metadata: Effects and ReactDeps
    for entity in &entities {
        // Find the prefix for monorepos
        let prefix = if entity.id.starts_with("workspace:") {
            let parts: Vec<&str> = entity.id.split(':').collect();
            if parts.len() >= 3 {
                format!("{}:{}:", parts[0], parts[1])
            } else {
                "".to_string()
            }
        } else {
            "".to_string()
        };

        if let Some(dj) = &entity.data_json {
            if let Ok(dj_json) = serde_json::from_str::<serde_json::Value>(dj) {
                // useEffect / useLayoutEffect
                if let Some(effects) = dj_json["effects"].as_object() {
                    for (eff_id_raw, eff_val) in effects {
                        let eff_id = format!("{}{}", prefix, eff_id_raw);
                        let eff_name = eff_val["name"].as_str().unwrap_or("useEffect");
                        let line = eff_val["loc"]["line"].as_i64().unwrap_or(0) as i32;
                        let col = eff_val["loc"]["column"].as_i64().unwrap_or(0) as i32;

                        // Use block scope of the parent component/hook as combo_id
                        let combo_id = scopes
                            .iter()
                            .find(|s| s.entity_id == Some(entity.id.clone()))
                            .map(|s| s.id.clone())
                            .unwrap_or_else(|| entity.scope_id.clone());

                        ins_node
                            .execute(params![
                                eff_id,
                                eff_name,
                                "effect",
                                combo_id,
                                None::<String>,
                                14.0,
                                eff_name,
                                None::<String>
                            ])
                            .unwrap();

                        let scope = scopes.iter().find(|s| s.id == entity.scope_id);
                        let file_info = scope.and_then(|s| file_info_map.get(&s.file_id));

                        ins_detail
                            .execute(params![
                                eff_id,
                                file_info.map(|f| f.path.clone()),
                                file_info.and_then(|f| f.project_path.clone()),
                                line,
                                col,
                                None::<String>
                            ])
                            .unwrap();

                        if let Some(deps) = eff_val["reactDeps"].as_array() {
                            for dep in deps {
                                if let Some(dep_id_raw) = dep["id"].as_str() {
                                    let dep_id = format!("{}{}", prefix, dep_id_raw);
                                    add_edge_local(
                                        &dep_id,
                                        &eff_id,
                                        "effect-dep",
                                        "dependency",
                                        None,
                                    );
                                }
                            }
                        }
                    }
                }
                // reactDeps on hook result (useMemo / useCallback)
                if let Some(deps) = dj_json["reactDeps"].as_array() {
                    // Find the symbol associated with this entity
                    if let Some(sym) = symbols.iter().find(|s| s.entity_id == entity.id) {
                        for dep in deps {
                            if let Some(dep_id_raw) = dep["id"].as_str() {
                                let dep_id = format!("{}{}", prefix, dep_id_raw);
                                add_edge_local(&dep_id, &sym.id, "react-dep", "dependency", None);
                            }
                        }
                    }
                }
            }
        }
    }

    // Flush Edges
    for (id, (source, target, kind, count, usages)) in edge_map {
        let meta = if usages.is_empty() {
            None
        } else {
            Some(serde_json::json!({ "usageCount": count, "usages": usages }).to_string())
        };
        ins_edge
            .execute(params![id, source, target, kind, kind, kind, meta])
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
