import {
  type GraphViewTask,
  type TaskContext,
} from "@nexiq/extension-sdk";

/**
 * Task that groups components and hooks by their directory and file structure.
 * Refactored to use runSqlite for better performance and to wrap existing items.
 */
export const fileTask: GraphViewTask = {
  id: "file-view",
  priority: 20,
  runSqlite: (context: TaskContext) => {
    const { db } = context;
    if (!db) return;

    // 1. Ensure all file/directory/package combos exist
    const packages = db.prepare("SELECT * FROM packages").all() as any[];
    const files = db.prepare("SELECT * FROM files").all() as any[];

    const packageMap = new Map(packages.map((p) => [p.id, p]));
    
    // Track what we've added to out_combos
    const existingComboIds = new Set(
      (db.prepare("SELECT id FROM out_combos").all() as { id: string }[]).map(
        (row) => row.id,
      ),
    );

    const createdDirs = new Set<string>();
    const createdPackages = new Set<string>();

    for (const id of existingComboIds) {
      if (id.startsWith("dir:")) createdDirs.add(id.slice(4));
      if (id.startsWith("package:")) createdPackages.add(id.slice(8));
    }

    const insCombo = db.prepare(
      "INSERT OR IGNORE INTO out_combos (id, name, type, parent_id, display_name, radius, collapsed) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );

    for (const file of files) {
      const filePath = file.path;
      const packageId = file.package_id;
      const pkg = packageId ? packageMap.get(packageId) : undefined;
      const packageComboId = packageId ? `package:${packageId}` : null;

      // Create package combo
      if (packageId && pkg && !createdPackages.has(packageId)) {
        if (!existingComboIds.has(`package:${packageId}`)) {
          insCombo.run(
            `package:${packageId}`,
            pkg.name,
            "package",
            null,
            pkg.name,
            24,
            1
          );
          existingComboIds.add(`package:${packageId}`);
        }
        createdPackages.add(packageId);
      }

      // Create folder combos
      const parts = filePath.split("/").filter(Boolean);
      let currentPath = "";

      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i]!;
        const parentPath = currentPath;
        currentPath = currentPath ? `${currentPath}/${part}` : `/${part}`;

        if (!createdDirs.has(currentPath)) {
          const dirId = `dir:${currentPath}`;
          if (!existingComboIds.has(dirId)) {
            insCombo.run(
              dirId,
              part,
              "directory",
              parentPath ? `dir:${parentPath}` : packageComboId,
              part,
              20,
              1
            );
            existingComboIds.add(dirId);
          }
          createdDirs.add(currentPath);
        }
      }

      // Create file combo
      const fileName = parts[parts.length - 1]!;
      const dirPath = parts.slice(0, -1).join("/");
      const fileId = `file:${filePath}`;

      if (!existingComboIds.has(fileId)) {
        insCombo.run(
          fileId,
          fileName,
          "file",
          dirPath ? `dir:/${dirPath}` : packageComboId,
          fileName,
          18,
          1
        );
        existingComboIds.add(fileId);
      }
    }

    // 2. Add missing components and hooks as nodes (Fallback logic)
    // We only add them if they don't exist yet in out_nodes OR out_combos
    // Using a more flexible join to handle both prefixed and non-prefixed IDs
    const symbols = db.prepare(`
      SELECT s.id, s.name, e.kind, f.path as file_name
      FROM symbols s
      JOIN entities e ON s.entity_id = e.id
      JOIN scopes sc ON s.scope_id = sc.id
      JOIN files f ON sc.file_id = f.id
      WHERE e.kind IN ('component', 'hook')
    `).all() as any[];

    const insNode = db.prepare(
      "INSERT OR IGNORE INTO out_nodes (id, name, type, combo_id, radius, display_name) VALUES (?, ?, ?, ?, ?, ?)",
    );

    for (const sym of symbols) {
      // Check if it's already represented in out_nodes or out_combos
      const existsInNodes = db.prepare("SELECT 1 FROM out_nodes WHERE id = ?").get(sym.id);
      const existsInCombos = db.prepare("SELECT 1 FROM out_combos WHERE id = ?").get(sym.id);
      
      if (!existsInNodes && !existsInCombos) {
        insNode.run(
          sym.id,
          sym.name,
          sym.kind,
          `file:${sym.file_name}`,
          20,
          sym.name
        );
      }
    }

    // 3. Re-parent existing nodes/combos to their file combos
    // Update nodes
    db.exec(`
      UPDATE out_nodes
      SET combo_id = (
        SELECT 'file:' || f.path
        FROM symbols s
        JOIN scopes sc ON s.scope_id = sc.id
        JOIN files f ON sc.file_id = f.id
        WHERE s.id = out_nodes.id
      )
      WHERE (combo_id IS NULL OR combo_id LIKE 'package:%')
      AND EXISTS (
        SELECT 1
        FROM symbols s
        JOIN scopes sc ON s.scope_id = sc.id
        JOIN files f ON sc.file_id = f.id
        WHERE s.id = out_nodes.id
      )
    `);

    // Update combos (but not the ones we just created for files/dirs/pkgs)
    db.exec(`
      UPDATE out_combos
      SET parent_id = (
        SELECT 'file:' || f.path
        FROM symbols s
        JOIN scopes sc ON s.scope_id = sc.id
        JOIN files f ON sc.file_id = f.id
        WHERE s.id = out_combos.id
      )
      WHERE (parent_id IS NULL OR parent_id LIKE 'package:%')
      AND id NOT LIKE 'file:%' AND id NOT LIKE 'dir:%' AND id NOT LIKE 'package:%'
      AND EXISTS (
        SELECT 1
        FROM symbols s
        JOIN scopes sc ON s.scope_id = sc.id
        JOIN files f ON sc.file_id = f.id
        WHERE s.id = out_combos.id
      )
    `);
  },
};
