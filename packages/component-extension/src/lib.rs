#[macro_use]
extern crate napi_derive;

use napi::bindgen_prelude::*;
use rusqlite::Connection;
use std::collections::{HashMap, HashSet};

#[allow(warnings)]
mod graph_view_generated;
// Avoid glob import to prevent name collisions
use graph_view_generated::nexiq::graph_view::{
    GraphCombo as FBGraphCombo, GraphComboArgs, GraphEdge as FBGraphEdge, GraphEdgeArgs,
    GraphNode as FBGraphNode, GraphNodeArgs, GraphNodeDetail as FBGraphNodeDetail,
    GraphNodeDetailArgs, GraphView as FBGraphView, GraphViewArgs, Loc, LocArgs,
};

#[napi(object)]
pub struct TaskContext {
    pub project_root: String,
    pub sqlite_path: String,
    pub view_type: String,
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
pub fn run_component_task(
    mut node_data_buffer: Buffer,
    mut detail_buffer: Buffer,
    context: TaskContext,
) -> Result<u32> {
    let sqlite_path = std::path::Path::new(&context.sqlite_path);
    if sqlite_path.is_dir() {
        return Err(Error::from_reason(format!(
            "SQLite path is a directory, not a file: {}",
            context.sqlite_path
        )));
    }

    let conn = Connection::open(&context.sqlite_path)
        .map_err(|e| Error::from_reason(format!("Failed to open SQLite: {}", e)))?;

    // 1. Fetch data
    let packages: Vec<PackageRow> = if table_exists(&conn, "packages") {
        let mut stmt = conn
            .prepare("SELECT id, name, version, path FROM packages")
            .unwrap();
        stmt.query_map([], |row| {
            Ok(PackageRow {
                id: row.get(0)?,
                name: row.get(1)?,
                version: row.get(2)?,
                path: row.get(3)?,
            })
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
    } else {
        Vec::new()
    };

    let files: Vec<FileRow> = if table_exists(&conn, "files") {
        let mut stmt = conn
            .prepare("SELECT id, path, package_id FROM files")
            .unwrap();
        stmt.query_map([], |row| {
            Ok(FileRow {
                id: row.get(0)?,
                path: row.get(1)?,
                package_id: row.get(2)?,
            })
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
    } else {
        Vec::new()
    };

    let entities: Vec<EntityRow> = if table_exists(&conn, "entities") {
        let mut stmt = conn
            .prepare(
                "SELECT id, scope_id, kind, name, type, line, \"column\", data_json FROM entities",
            )
            .unwrap();
        stmt.query_map([], |row| {
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
        .collect()
    } else {
        Vec::new()
    };

    let symbols: Vec<SymbolRow> = if table_exists(&conn, "symbols") {
        let mut stmt = conn
            .prepare("SELECT id, entity_id, scope_id, name, path FROM symbols")
            .unwrap();
        stmt.query_map([], |row| {
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
        .collect()
    } else {
        Vec::new()
    };

    let scopes: Vec<ScopeRow> = if table_exists(&conn, "scopes") {
        let mut stmt = conn
            .prepare("SELECT id, file_id, parent_id, kind, entity_id FROM scopes")
            .unwrap();
        stmt.query_map([], |row| {
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
        .collect()
    } else {
        Vec::new()
    };

    let relations: Vec<RelationRow> = if table_exists(&conn, "relations") {
        let mut stmt = conn
            .prepare("SELECT from_id, to_id, kind, data_json FROM relations")
            .unwrap();
        stmt.query_map([], |row| {
            Ok(RelationRow {
                from_id: row.get(0)?,
                to_id: row.get(1)?,
                kind: row.get(2)?,
                data_json: row.get(3)?,
            })
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
    } else {
        Vec::new()
    };

    // 2. Logic Implementation
    let mut node_list: Vec<LocalNode> = Vec::new();
    let mut combo_list: Vec<LocalCombo> = Vec::new();
    let mut edge_list: Vec<LocalEdge> = Vec::new();
    let mut detail_list: Vec<LocalDetail> = Vec::new();

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
    let mut package_combo_added: HashSet<String> = HashSet::new();
    let mut combo_map: HashMap<String, LocalCombo> = HashMap::new();

    // 1. Process Scopes into Combos First
    // Skip module-kind scopes — they're file-level wrappers with no visual value;
    // their children get re-parented to the package combo directly.
    for scope in &scopes {
        if scope.kind == "module" {
            continue;
        }

        let mut parent_combo_id = scope.parent_id.clone().and_then(|pid| {
            scopes
                .iter()
                .find(|s| s.id == pid && s.kind != "module")
                .map(|_| pid)
        });

        if parent_combo_id.is_none() && use_package_combos {
            if let Some(file_info) = file_info_map.get(&scope.file_id) {
                if let Some(pkg_id) = &file_info.package_id {
                    let pkg_combo_id = format!("pkg-{}", pkg_id);
                    parent_combo_id = Some(pkg_combo_id.clone());

                    if !package_combo_added.contains(&pkg_combo_id) {
                        if let Some(pkg) = packages.iter().find(|p| p.id == *pkg_id) {
                            combo_map.insert(
                                pkg_combo_id.clone(),
                                LocalCombo {
                                    id: pkg_combo_id.clone(),
                                    item_type: InternalItemType::Package,
                                    name: pkg.name.clone(),
                                    display_name: pkg.name.clone(),
                                    parent_id: None,
                                    color: None,
                                    radius: None,
                                    collapsed: true,
                                },
                            );
                            package_combo_added.insert(pkg_combo_id);
                        }
                    }
                }
            }
        }

        combo_map.insert(
            scope.id.clone(),
            LocalCombo {
                id: scope.id.clone(),
                item_type: InternalItemType::Scope,
                name: scope.kind.clone(),
                display_name: scope.kind.clone(),
                parent_id: parent_combo_id,
                color: None,
                radius: None,
                collapsed: true,
            },
        );
    }

    let mut automatic_jsx_entities = HashSet::new();
    for symbol in &symbols {
        if symbol.name.starts_with("jsx@") {
            automatic_jsx_entities.insert(symbol.entity_id.clone());
        }
    }

    for symbol in &symbols {
        if symbol.name.starts_with("jsx@") {
            continue;
        }
        let entity = entities.iter().find(|e| e.id == symbol.entity_id);
        if entity.is_none() {
            continue;
        }
        let entity = entity.unwrap();
        if entity.kind == "import" {
            continue;
        }

        let scope = scopes.iter().find(|s| s.id == symbol.scope_id);
        let file_info = scope.and_then(|s| file_info_map.get(&s.file_id));

        let block_scope = scopes
            .iter()
            .find(|s| s.entity_id == Some(entity.id.clone()));

        if let Some(bs) = block_scope {
            if let Some(combo) = combo_map.get_mut(&bs.id) {
                combo.item_type = map_item_type(&entity.kind);
                combo.name = symbol.name.clone();
                combo.display_name = symbol.name.clone();
            }
            detail_list.push(LocalDetail {
                id: bs.id.clone(),
                file_name: file_info.map(|f| f.path.clone()),
                project_path: file_info.and_then(|f| f.project_path.clone()),
                line: entity.line.unwrap_or(0),
                column: entity.column.unwrap_or(0),
                data_json: entity.data_json.clone(),
            });
        } else {
            let mut parent_combo_id = scope
                .filter(|s| s.kind != "module")
                .map(|_| symbol.scope_id.clone());

            if parent_combo_id.is_none() && use_package_combos {
                if let Some(fi) = file_info.as_ref() {
                    if let Some(pkg_id) = &fi.package_id {
                        parent_combo_id = Some(format!("pkg-{}", pkg_id));
                    }
                }
            }

            node_list.push(LocalNode {
                id: symbol.id.clone(),
                item_type: map_item_type(&entity.kind),
                name: symbol.name.clone(),
                display_name: symbol.name.clone(),
                combo_id: parent_combo_id,
                color: None,
                radius: None,
            });
            detail_list.push(LocalDetail {
                id: symbol.id.clone(),
                file_name: file_info.map(|f| f.path.clone()),
                project_path: file_info.and_then(|f| f.project_path.clone()),
                line: entity.line.unwrap_or(0),
                column: entity.column.unwrap_or(0),
                data_json: entity.data_json.clone(),
            });
        }
    }

    combo_list.extend(combo_map.into_values());

    // Edges
    for rel in &relations {
        if rel.kind == "parent-child" {
            continue;
        }
        edge_list.push(LocalEdge {
            id: format!("{}-{}-{}", rel.from_id, rel.to_id, rel.kind),
            source: rel.from_id.clone(),
            target: rel.to_id.clone(),
            name: rel.kind.clone(),
            kind: rel.kind.clone(),
            category: rel.kind.clone(),
        });
    }

    // 3. FlatBuffer Construction (Manual using Builder)
    let mut builder = flatbuffers::FlatBufferBuilder::with_capacity(1024 * 1024);

    // Convert Nodes
    let mut fb_nodes = Vec::new();
    for node in &node_list {
        let id = builder.create_string(&node.id);
        let name = builder.create_string(&node.name);
        let display_name = builder.create_string(&node.display_name);
        let combo_id = node.combo_id.as_ref().map(|c| builder.create_string(c));
        let color = node.color.as_ref().map(|c| builder.create_string(c));

        let mut args = GraphNodeArgs {
            id: Some(id),
            name: Some(name),
            displayName: Some(display_name),
            type_: graph_view_generated::nexiq::graph_view::ItemType(node.item_type as i8),
            comboId: combo_id,
            color: color,
            radius: node.radius.unwrap_or(0.0),
        };
        fb_nodes.push(FBGraphNode::create(&mut builder, &args));
    }
    let nodes_vector = builder.create_vector(&fb_nodes);

    // Convert Combos
    let mut fb_combos = Vec::new();
    for combo in &combo_list {
        let id = builder.create_string(&combo.id);
        let name = builder.create_string(&combo.name);
        let display_name = builder.create_string(&combo.display_name);
        let parent_id = combo.parent_id.as_ref().map(|c| builder.create_string(c));
        let color = combo.color.as_ref().map(|c| builder.create_string(c));

        let args = GraphComboArgs {
            id: Some(id),
            name: Some(name),
            displayName: Some(display_name),
            type_: graph_view_generated::nexiq::graph_view::ItemType(combo.item_type as i8),
            parentId: parent_id,
            color: color,
            radius: combo.radius.unwrap_or(0.0),
            collapsed: combo.collapsed,
        };
        fb_combos.push(FBGraphCombo::create(&mut builder, &args));
    }
    let combos_vector = builder.create_vector(&fb_combos);

    // Convert Edges
    let mut fb_edges = Vec::new();
    for edge in &edge_list {
        let id = builder.create_string(&edge.id);
        let source = builder.create_string(&edge.source);
        let target = builder.create_string(&edge.target);
        let name = builder.create_string(&edge.name);
        let kind = builder.create_string(&edge.kind);
        let category = builder.create_string(&edge.category);

        let args = GraphEdgeArgs {
            id: Some(id),
            source: Some(source),
            target: Some(target),
            name: Some(name),
            kind: Some(kind),
            category: Some(category),
        };
        fb_edges.push(FBGraphEdge::create(&mut builder, &args));
    }
    let edges_vector = builder.create_vector(&fb_edges);

    // Convert Details
    let mut fb_details = Vec::new();
    for detail in &detail_list {
        let id = builder.create_string(&detail.id);
        let file_name = detail.file_name.as_ref().map(|f| builder.create_string(f));
        let project_path = detail
            .project_path
            .as_ref()
            .map(|p| builder.create_string(p));
        let data_json = detail.data_json.as_ref().map(|d| builder.create_string(d));

        let loc_args = LocArgs {
            line: detail.line,
            column: detail.column,
        };
        let loc = Loc::create(&mut builder, &loc_args);

        let args = GraphNodeDetailArgs {
            id: Some(id),
            fileName: file_name,
            projectPath: project_path,
            loc: Some(loc),
            data_json: data_json,
        };
        fb_details.push(FBGraphNodeDetail::create(&mut builder, &args));
    }
    let details_vector = builder.create_vector(&fb_details);

    let graph_view_args = GraphViewArgs {
        nodes: Some(nodes_vector),
        combos: Some(combos_vector),
        edges: Some(edges_vector),
        details: Some(details_vector),
    };

    let root = FBGraphView::create(&mut builder, &graph_view_args);
    builder.finish(root, Some("NXGV"));

    let finished_data = builder.finished_data();

    if finished_data.len() > node_data_buffer.len() {
        return Err(Error::from_reason(
            "nodeDataBuffer is too small for FlatBuffer output!",
        ));
    }
    node_data_buffer[..finished_data.len()].copy_from_slice(finished_data);

    println!(
        "Processed {} nodes, {} edges, {} combos into flatbuffer!",
        node_list.len(),
        edge_list.len(),
        combo_list.len()
    );

    Ok(finished_data.len() as u32)
}
