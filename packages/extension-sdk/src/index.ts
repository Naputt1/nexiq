import type { Database } from "better-sqlite3";
import fs from "node:fs";
import type {
  TypeDataDeclare,
  ComponentFileVar,
  VariableName,
  DatabaseData,
  GraphViewType,
  WorkspacePackageRow,
  PackageRow,
  PackageDependencyRow,
  FileRow,
  ScopeRow,
  EntityRow,
  SymbolRow,
  RenderRow,
  ExportRow,
  RelationRow,
} from "@nexiq/shared";

// Re-exporting these from shared for convenience if needed by extensions
export type {
  TypeDataDeclare,
  ComponentFileVar,
  VariableName,
  DatabaseData,
  GraphViewType,
};

export interface GraphItemPosition {
  x: number;
  y: number;
}

export interface GraphNodeData {
  id: string;
  name: VariableName | string;
  label?: { text: string; fill?: string };
  type?: string;
  projectPath?: string;
  fileName?: string;
  pureFileName?: string;
  loc?: { line: number; column: number };
  radius?: number;
  color?: string;
  combo?: string;
  gitStatus?: "added" | "modified" | "deleted";
  declarationKind?: "const" | "let" | "var" | "using" | "await using";
  tag?: string;
  raw?: ComponentFileVar;
  displayName?: string;
  [key: string]: unknown;
}

export interface GraphComboData extends GraphNodeData {
  collapsed?: boolean;
  collapsedRadius?: number;
  expandedRadius?: number;
  padding?: number;
  [key: string]: unknown;
}

export interface GraphArrowData {
  id: string;
  source: string;
  target: string;
  label?: string;
  combo?: string;
  [key: string]: unknown;
}

export interface useGraphProps {
  nodes: GraphNodeData[];
  edges: GraphArrowData[];
  combos: GraphComboData[];
}

export interface GraphViewResult extends useGraphProps {
  typeData: Record<string, TypeDataDeclare>;
}

/**
 * Context provided to tasks during graph view generation.
 */
export interface TaskContext {
  /**
   * Database instance for querying graph data.
   */
  db?: Database;
  /**
   * Root path of the project being analyzed.
   */
  projectRoot: string;
  /**
   * Specific paths within the project to focus analysis on.
   */
  analysisPaths?: string[];
  /**
   * The type of view being generated.
   */
  viewType: GraphViewType;
  /**
   * Optional pre-loaded snapshot data, for backward compatibility or when already available.
   */
  snapshotData?: DatabaseData;
}

/**
 * Helper to retrieve required graph data from either TaskContext.snapshotData or TaskContext.db.
 * It handles workspace databases and qualifies IDs to avoid collisions.
 */
export function getTaskData(context: TaskContext): DatabaseData {
  const { db, snapshotData, analysisPaths } = context;

  if (snapshotData) {
    return snapshotData;
  }

  if (!db) {
    return {
      files: [],
      entities: [],
      scopes: [],
      symbols: [],
      renders: [],
      exports: [],
      relations: [],
    };
  }

  const tableExists = (name: string) =>
    !!db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?",
      )
      .get(name);

  if (tableExists("workspace_packages")) {
    const workspacePackages = db
      .prepare("SELECT * FROM workspace_packages")
      .all() as WorkspacePackageRow[];
    const filteredPackages =
      analysisPaths && analysisPaths.length > 0
        ? workspacePackages.filter((p) => analysisPaths.includes(p.path))
        : workspacePackages;

    const aggregated: DatabaseData = {
      packages: [],
      package_dependencies: [],
      files: [],
      entities: [],
      scopes: [],
      symbols: [],
      renders: [],
      exports: [],
      relations: [],
    };

    filteredPackages.forEach((pkg, index) => {
      if (!fs.existsSync(pkg.db_path)) {
        console.warn(`Package database not found at ${pkg.db_path}`);
        return;
      }

      // Open individual package databases one by one to avoid SQLITE_LIMIT_ATTACHED
      const DbConstructor = db.constructor as new (
        path: string,
        options?: { readonly?: boolean },
      ) => Database;
      const pkgDb = new DbConstructor(pkg.db_path, { readonly: true });
      try {
        const fileIdOffset = (index + 1) * 1000000;
        const pkgPrefix = `workspace:${pkg.package_id}:`;
        const pkgId = pkg.package_id;

        const pkgTableExists = (name: string) =>
          !!pkgDb
            .prepare(
              "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?",
            )
            .get(name);

        // 1. Packages & Dependencies
        const pkgRows = pkgTableExists("packages")
          ? (pkgDb.prepare("SELECT * FROM packages").all() as PackageRow[])
          : [];

        if (pkgRows.length > 0) {
          aggregated.packages!.push(
            ...pkgRows.map((p) => ({
              ...p,
              id: pkgId, // Force ID consistency with workspace remapping
            })),
          );
        } else {
          aggregated.packages!.push({
            id: pkgId,
            name: pkg.name,
            version: pkg.version || "0.0.0",
            path: pkg.path,
          });
        }

        if (pkgTableExists("package_dependencies")) {
          aggregated.package_dependencies!.push(
            ...(pkgDb
              .prepare("SELECT * FROM package_dependencies")
              .all() as PackageDependencyRow[]),
          );
        }

        // 2. Files
        const fRows = pkgDb.prepare("SELECT * FROM files").all() as FileRow[];
        aggregated.files.push(
          ...fRows.map((f) => ({
            ...f,
            id: f.id + fileIdOffset,
            package_id: f.package_id || pkgId,
          })),
        );

        // 3. Scopes
        const sRows = pkgDb
          .prepare(
            `SELECT 
              '${pkgPrefix}' || id as id,
              file_id + ${fileIdOffset} as file_id,
              CASE WHEN parent_id IS NOT NULL THEN '${pkgPrefix}' || parent_id ELSE NULL END as parent_id,
              CASE WHEN entity_id IS NOT NULL THEN '${pkgPrefix}' || entity_id ELSE NULL END as entity_id,
              kind, data_json
            FROM scopes`,
          )
          .all() as ScopeRow[];
        aggregated.scopes.push(...sRows);

        // 4. Entities
        const eRows = pkgDb
          .prepare(
            `SELECT 
              '${pkgPrefix}' || id as id,
              '${pkgPrefix}' || scope_id as scope_id,
              kind, name, type, line, "column", end_line, end_column, declaration_kind, data_json
            FROM entities`,
          )
          .all() as EntityRow[];
        aggregated.entities.push(...eRows);

        // 5. Symbols
        const symRows = pkgDb
          .prepare(
            `SELECT 
              '${pkgPrefix}' || id as id,
              '${pkgPrefix}' || entity_id as entity_id,
              '${pkgPrefix}' || scope_id as scope_id,
              name, path, is_alias, has_default, data_json
            FROM symbols`,
          )
          .all() as SymbolRow[];
        aggregated.symbols.push(...symRows);

        // 6. Renders
        const rRows = pkgDb
          .prepare(
            `SELECT 
              '${pkgPrefix}' || id as id,
              file_id + ${fileIdOffset} as file_id,
              '${pkgPrefix}' || parent_entity_id as parent_entity_id,
              CASE WHEN parent_render_id IS NOT NULL THEN '${pkgPrefix}' || parent_render_id ELSE NULL END as parent_render_id,
              CASE WHEN symbol_id IS NOT NULL THEN '${pkgPrefix}' || symbol_id ELSE NULL END as symbol_id,
              tag, render_index, line, "column", kind, data_json
            FROM renders`,
          )
          .all() as RenderRow[];
        aggregated.renders.push(...rRows);

        // 7. Exports
        if (pkgTableExists("exports")) {
          const expRows = pkgDb
            .prepare(
              `SELECT 
                '${pkgPrefix}' || id as id,
                '${pkgPrefix}' || scope_id as scope_id,
                CASE WHEN symbol_id IS NOT NULL THEN '${pkgPrefix}' || symbol_id ELSE NULL END as symbol_id,
                CASE WHEN entity_id IS NOT NULL THEN '${pkgPrefix}' || entity_id ELSE NULL END as entity_id,
                name, is_default
              FROM exports`,
            )
            .all() as ExportRow[];
          aggregated.exports.push(...expRows);
        }

        // 8. Relations
        const relRows = pkgDb
          .prepare(
            `SELECT 
              '${pkgPrefix}' || from_id as from_id,
              '${pkgPrefix}' || to_id as to_id,
              kind, line, "column", data_json
            FROM relations`,
          )
          .all() as RelationRow[];
        aggregated.relations.push(...relRows);
      } finally {
        pkgDb.close();
      }
    });

    return aggregated;
  }

  // Single project database fallback
  const hasPackages = tableExists("packages");
  const hasDeps = tableExists("package_dependencies");
  const hasExports = tableExists("exports");

  return {
    packages: hasPackages
      ? (db.prepare("SELECT * FROM packages").all() as PackageRow[])
      : [],
    package_dependencies: hasDeps
      ? (db
          .prepare("SELECT * FROM package_dependencies")
          .all() as PackageDependencyRow[])
      : [],
    files: db.prepare("SELECT * FROM files").all() as FileRow[],
    entities: db.prepare("SELECT * FROM entities").all() as EntityRow[],
    scopes: db.prepare("SELECT * FROM scopes").all() as ScopeRow[],
    symbols: db.prepare("SELECT * FROM symbols").all() as SymbolRow[],
    renders: db.prepare("SELECT * FROM renders").all() as RenderRow[],
    exports: hasExports
      ? (db.prepare("SELECT * FROM exports").all() as ExportRow[])
      : [],
    relations: db.prepare("SELECT * FROM relations").all() as RelationRow[],
  };
}

/**
 * A task that contributes to the construction of a graph view.
 */
export interface GraphViewTask {
  id: string;
  priority: number;
  /**
   * Run the task to update the graph result.
   *
   * @param result The current graph result to be updated
   * @param context Context containing database and project information
   * @returns Updated GraphViewResult
   */
  run: (result: GraphViewResult, context: TaskContext) => GraphViewResult;
}

export interface DetailSectionProps {
  selectedId: string;
  item: GraphNodeData | GraphComboData;
  graph: unknown; // GraphData instance
  projectPath: string;
  typeData: Record<string, TypeDataDeclare>;
  onSelect?: (id: string) => void;
  renderNodes?: GraphNodeData[];
}

export interface DetailSection {
  id: string;
  title: string;
  priority: number;
  component: React.ComponentType<DetailSectionProps>;
  shouldShow: (item: GraphNodeData | GraphComboData) => boolean;
  defaultOpen?: boolean;
}

export interface MCPToolHandlerArgs {
  projectPath?: string;
  projectManager: unknown; // We use unknown here to avoid dependency on server package
  [key: string]: unknown;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: MCPToolHandlerArgs) => Promise<unknown>;
}

export interface Extension {
  id: string;
  viewTasks?: Record<string, GraphViewTask[]>; // Mapping of GraphViewType to tasks
  detailSections?: DetailSection[];
  mcpTools?: MCPTool[];
}

export * from "./tasks/componentTask.js";
export * from "./tasks/gitTask.js";
