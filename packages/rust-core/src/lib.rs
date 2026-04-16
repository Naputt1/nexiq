use rusqlite::Connection;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
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
    Variable = 14,
}

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
}

pub struct ScopeRow {
    pub id: String,
    pub file_id: i32,
    pub parent_id: Option<String>,
    pub kind: String,
    pub entity_id: Option<String>,
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
    pub line: Option<i32>,
    pub column: Option<i32>,
    pub data_json: Option<String>,
}

pub struct FileInfo {
    pub path: String,
    pub package_id: Option<String>,
    pub project_path: Option<String>,
}

pub fn map_item_type(kind: &str) -> InternalItemType {
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
        "normal" | "variable" => InternalItemType::Variable,
        _ => InternalItemType::Scope,
    }
}

pub fn table_exists(conn: &Connection, name: &str) -> bool {
    let sql = "SELECT 1 FROM sqlite_master WHERE name = ?1 AND type IN ('table', 'view')
               UNION ALL
               SELECT 1 FROM sqlite_temp_master WHERE name = ?1 AND type IN ('table', 'view')";
    conn.query_row(sql, [name], |_| Ok(())).is_ok()
}
