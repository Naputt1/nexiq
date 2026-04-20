import {
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
      if (id.includes("-render-")) {
        baseId = id.split("-render-")[0]!;
      } else if (id.includes("-props")) {
        baseId = id.split("-props")[0]!;
      } else if (id.includes(":prop:")) {
        baseId = id.split(":prop:")[0]!;
      } else if (id.includes(":")) {
        if (id.startsWith("workspace:")) {
          const parts = id.split(":");
          if (parts.length > 3) {
            baseId = parts.slice(0, -1).join(":");
          }
        } else {
          baseId = id.split(":")[0]!;
        }
      }

      const patterns = [id];
      // Only use LIKE pattern if baseId is actually different and not just a monorepo prefix
      if (
        baseId !== id &&
        (!id.startsWith("workspace:") || baseId.split(":").length > 2)
      ) {
        patterns.push(`${baseId}%`);
      }

      for (const p of patterns) {
        if (p.includes("%")) {
          updateStatus.run(status, "", p);
          updateComboStatus.run(status, "", p);
        } else {
          updateStatus.run(status, p, "");
          updateComboStatus.run(status, p, "");
        }
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
