import {
  type GraphViewTask,
  type TaskContext,
} from "@nexiq/extension-sdk";

export const packageTask: GraphViewTask = {
  id: "package-task",
  priority: 10,
  runSqlite: (context: TaskContext) => {
    const { db } = context;
    if (!db) return;

    const packages = db.prepare("SELECT * FROM packages").all() as any[];
    const package_dependencies = db.prepare("SELECT * FROM package_dependencies").all() as any[];

    if (!packages.length && !package_dependencies.length) return;

    const insNode = db.prepare(
      "INSERT OR IGNORE INTO out_nodes (id, name, type, color, display_name) VALUES (?, ?, ?, ?, ?)",
    );

    for (const pkg of packages) {
      insNode.run(
        pkg.id,
        pkg.name,
        "package",
        "#4CAF50",
        pkg.name
      );
    }

    const insEdge = db.prepare(
      "INSERT OR IGNORE INTO out_edges (id, source, target, name) VALUES (?, ?, ?, ?)",
    );

    for (const dep of package_dependencies) {
      const targetId = `${dep.dependency_name}@${dep.dependency_version}`;
      const edgeId = `${dep.package_id}->${targetId}`;

      // Insert target package as node if not exists
      insNode.run(
        targetId,
        dep.dependency_name,
        "external-package",
        "#9E9E9E",
        targetId
      );

      // Insert edge
      insEdge.run(
        edgeId,
        dep.package_id,
        targetId,
        dep.is_dev ? "dev" : "prod"
      );
    }
  },
};
