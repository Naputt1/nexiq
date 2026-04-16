import {
  type GraphComboData,
  type GraphNodeData,
  type GraphViewResult,
  type GraphViewTask,
  type TaskContext,
  getTaskData,
} from "@nexiq/extension-sdk";

/**
 * Task that applies Git status (added, modified, deleted) to nodes and combos.
 * This runs after the base graph has been generated.
 */
export const gitTask: GraphViewTask = {
  id: "git-status",
  priority: 100, // Run late to ensure all nodes/combos are present
  run: (result: GraphViewResult, context: TaskContext): GraphViewResult => {
    const data = getTaskData(context);
    const { added = [], modified = [], deleted = [] } = data.diff || {};

    // Skip if no diff data
    if (added.length === 0 && modified.length === 0 && deleted.length === 0) {
      return result;
    }

    const combos = [...result.combos];
    const nodes = [...result.nodes];

    const applyStatus = (item: GraphComboData | GraphNodeData) => {
      // Find the base ID for mapping (e.g., stripping '-render-instanceId')
      let baseId = item.id;
      if (item.id.includes("-render-")) {
        baseId = item.id.split("-render-")[0]!;
      } else if (item.id.includes("-props")) {
        baseId = item.id.split("-props")[0]!;
      } else if (item.id.includes(":")) {
        // Handle virtual variables (parent:id)
        baseId = item.id.split(":")[0]!;
      }

      if (added.includes(item.id) || added.includes(baseId)) {
        item.gitStatus = "added";
      } else if (modified.includes(item.id) || modified.includes(baseId)) {
        item.gitStatus = "modified";
      } else if (deleted.includes(item.id) || deleted.includes(baseId)) {
        item.gitStatus = "deleted";
      }
    };

    nodes.forEach(applyStatus);
    combos.forEach(applyStatus);

    // Aggregate statuses for specialized combos (like 'props')
    combos.forEach((combo) => {
      if (combo.id.endsWith("-props")) {
        const childStatuses = [
          ...nodes.filter((n) => n.combo === combo.id).map((n) => n.gitStatus),
          ...combos.filter((c) => c.combo === combo.id).map((c) => c.gitStatus),
        ].filter(Boolean);

        if (childStatuses.length > 0) {
          const unique = new Set(childStatuses);
          if (unique.size === 1) {
            combo.gitStatus = childStatuses[0] as
              | "added"
              | "modified"
              | "deleted";
          } else {
            combo.gitStatus = "modified";
          }
        }
      }
    });

    return {
      ...result,
      nodes,
      combos,
    };
  },
  runSqlite: (context: TaskContext): void => {
    const db = context.db;
    if (!db) return;

    // We can get diff from taskDataCache if available, or just use context.snapshotData
    // For now, let's assume getTaskData is still useful for small data like diffs
    const data = getTaskData(context);
    const { added = [], modified = [], deleted = [] } = data.diff || {};

    if (added.length === 0 && modified.length === 0 && deleted.length === 0) {
      return;
    }

    const updateStatus = db.prepare(
      "UPDATE out_nodes SET git_status = ? WHERE id = ? OR id LIKE ?",
    );
    const updateComboStatus = db.prepare(
      "UPDATE out_combos SET git_status = ? WHERE id = ? OR id LIKE ?",
    );

    const apply = (id: string, status: string) => {
      // Find base ID logic (stripping render-instance etc)
      let baseId = id;
      if (id.includes("-render-")) baseId = id.split("-render-")[0]!;
      else if (id.includes("-props")) baseId = id.split("-props")[0]!;
      else if (id.includes(":")) baseId = id.split(":")[0]!;

      const patterns = [id, `${baseId}%`];
      for (const p of patterns) {
        updateStatus.run(status, p, p);
        updateComboStatus.run(status, p, p);
      }
    };

    added.forEach((id) => apply(id, "added"));
    modified.forEach((id) => apply(id, "modified"));
    deleted.forEach((id) => apply(id, "deleted"));

    // Aggregate statuses for specialized combos (like 'props')
    const propsCombos = db
      .prepare("SELECT id FROM out_combos WHERE id LIKE '%-props'")
      .all() as { id: string }[];
    for (const combo of propsCombos) {
      const childStatuses = [
        ...(db
          .prepare("SELECT git_status FROM out_nodes WHERE combo_id = ?")
          .all(combo.id) as { git_status: string }[]),
        ...(db
          .prepare("SELECT git_status FROM out_combos WHERE parent_id = ?")
          .all(combo.id) as { git_status: string }[]),
      ]
        .map((r) => r.git_status)
        .filter(Boolean);

      if (childStatuses.length > 0) {
        const unique = new Set(childStatuses);
        const status = unique.size === 1 ? childStatuses[0] : "modified";
        db.prepare("UPDATE out_combos SET git_status = ? WHERE id = ?").run(
          status,
          combo.id,
        );
      }
    }
  },
};
