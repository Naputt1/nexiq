import type { GraphViewTask, TaskContext } from "@nexiq/extension-sdk";

export const exampleTask: GraphViewTask = {
  id: "example-analysis",
  priority: 50,
  runSqlite: (context: TaskContext) => {
    const { db } = context;
    if (!db) return;

    // Input tables available: packages, files, entities, scopes,
    // symbols, renders, exports, relations
    //
    // Output tables to write to:
    //   out_nodes (id, name, type, combo_id, color, radius, display_name, git_status, meta_json)
    //   out_edges (id, source, target, name, kind, category, meta_json)
    //   out_combos (id, name, type, parent_id, color, radius, collapsed, display_name, git_status, meta_json)
    //   out_details (id, file_name, project_path, line, column, data_json)

    // Example: query entities and update matching nodes
    const rows = db
      .prepare(
        `SELECT e.id AS entity_id, s.id AS node_id, e.name
         FROM entities e
         JOIN symbols s ON s.entity_id = e.id
         WHERE e.kind = 'component'`,
      )
      .all() as { entity_id: string; node_id: string; name: string }[];

    const updateNode = db.prepare(
      `UPDATE out_nodes SET type = ?, color = ? WHERE id = ?`,
    );

    for (const row of rows) {
      updateNode.run("customType", "#8b5cf6", row.node_id);
    }
  },
};
