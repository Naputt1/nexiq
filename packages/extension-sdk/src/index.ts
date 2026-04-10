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

export interface UsageOccurrence {
  usageId: string;
  filePath: string;
  line: number;
  column: number;
  ownerId: string;
  ownerKind: string;
  accessPath?: string[] | undefined;
  isOptional?: boolean | undefined;
  isComputed?: boolean | undefined;
  hiddenIntermediate?: string | undefined;
  displayLabel?: string | undefined;
}

export interface NodeAppearance {
  color?: string | undefined;
  radius?: number | undefined;
}

export interface GraphAppearance {
  nodeHighlight?: string;
  comboHighlight?: string;
  arrowColor?: string;
  directFlowColor?: string;
  sideEffectFlowColor?: string;
  labelColor?: string;
  gitAdded?: string;
  gitModified?: string;
  gitDeleted?: string;
  nodes?: Partial<
    Record<
      | "package"
      | "scope"
      | "component"
      | "hook"
      | "renderGroup"
      | "sourceGroup"
      | "pathGroup"
      | "callback"
      | "state"
      | "memo"
      | "ref"
      | "effect"
      | "prop"
      | "render",
      NodeAppearance
    >
  >;
  typeKeyword?: string;
  typeLiteral?: string;
  typeString?: string;
  typeNumber?: string;
  typeBoolean?: string;
  typePunctuation?: string;
  typeReference?: string;
  typeComponent?: string;
  typeDefault?: string;
  genericsColor?: string;
}

export type CustomColors = GraphAppearance;

export const DEFAULT_GRAPH_APPEARANCE: GraphAppearance = {
  directFlowColor: "#2563eb",
  sideEffectFlowColor: "#f59e0b",
  gitAdded: "#22c55e",
  gitModified: "#f59e0b",
  gitDeleted: "#ef4444",
  nodes: {
    package: { color: "#0f766e", radius: 24 },
    scope: { color: "#475569", radius: 18 },
    component: { color: "#2563eb", radius: 20 },
    hook: { color: "#7c3aed", radius: 18 },
    renderGroup: { color: "#0ea5e9", radius: 18 },
    sourceGroup: { color: "#14b8a6", radius: 16 },
    pathGroup: { color: "#64748b", radius: 14 },
    callback: { color: "#ef4444", radius: 14 },
    state: { color: "#ef4444", radius: 16 },
    memo: { color: "#ef4444", radius: 14 },
    ref: { color: "#ef4444", radius: 14 },
    effect: { color: "#eab308", radius: 14 },
    prop: { color: "#22c55e", radius: 12 },
    render: { color: "#2563eb", radius: 14 },
  },
  typeKeyword: "#c084fc",
  typeLiteral: "#fdba74",
  typeString: "#86efac",
  typeNumber: "#93c5fd",
  typeBoolean: "#fde047",
  typePunctuation: "#6b7280",
  typeReference: "#60a5fa",
  typeComponent: "#67e8f9",
  typeDefault: "#d1d5db",
  genericsColor: "#fde047",
};

type LegacyNodeColorKeys = Partial<
  Record<
    | "stateNode"
    | "memoNode"
    | "callbackNode"
    | "refNode"
    | "effectNode"
    | "propNode"
    | "componentNode"
    | "hookNode"
    | "renderNode"
    | "packageNode",
    string
  >
>;

export function normalizeGraphAppearance(
  appearance?: GraphAppearance | null,
): GraphAppearance {
  const legacy = (appearance || {}) as GraphAppearance & LegacyNodeColorKeys;
  const nodes = {
    package: {
      ...DEFAULT_GRAPH_APPEARANCE.nodes?.package,
      color:
        legacy.packageNode ||
        appearance?.nodes?.package?.color ||
        DEFAULT_GRAPH_APPEARANCE.nodes?.package?.color,
      radius:
        appearance?.nodes?.package?.radius ??
        DEFAULT_GRAPH_APPEARANCE.nodes?.package?.radius,
    },
    scope: {
      ...DEFAULT_GRAPH_APPEARANCE.nodes?.scope,
      color:
        appearance?.nodes?.scope?.color ||
        DEFAULT_GRAPH_APPEARANCE.nodes?.scope?.color,
      radius:
        appearance?.nodes?.scope?.radius ??
        DEFAULT_GRAPH_APPEARANCE.nodes?.scope?.radius,
    },
    component: {
      ...DEFAULT_GRAPH_APPEARANCE.nodes?.component,
      color:
        legacy.componentNode ||
        appearance?.nodes?.component?.color ||
        DEFAULT_GRAPH_APPEARANCE.nodes?.component?.color,
      radius:
        appearance?.nodes?.component?.radius ??
        DEFAULT_GRAPH_APPEARANCE.nodes?.component?.radius,
    },
    hook: {
      ...DEFAULT_GRAPH_APPEARANCE.nodes?.hook,
      color:
        legacy.hookNode ||
        appearance?.nodes?.hook?.color ||
        DEFAULT_GRAPH_APPEARANCE.nodes?.hook?.color,
      radius:
        appearance?.nodes?.hook?.radius ??
        DEFAULT_GRAPH_APPEARANCE.nodes?.hook?.radius,
    },
    renderGroup: {
      ...DEFAULT_GRAPH_APPEARANCE.nodes?.renderGroup,
      color:
        appearance?.nodes?.renderGroup?.color ||
        DEFAULT_GRAPH_APPEARANCE.nodes?.renderGroup?.color,
      radius:
        appearance?.nodes?.renderGroup?.radius ??
        DEFAULT_GRAPH_APPEARANCE.nodes?.renderGroup?.radius,
    },
    sourceGroup: {
      ...DEFAULT_GRAPH_APPEARANCE.nodes?.sourceGroup,
      color:
        appearance?.nodes?.sourceGroup?.color ||
        DEFAULT_GRAPH_APPEARANCE.nodes?.sourceGroup?.color,
      radius:
        appearance?.nodes?.sourceGroup?.radius ??
        DEFAULT_GRAPH_APPEARANCE.nodes?.sourceGroup?.radius,
    },
    pathGroup: {
      ...DEFAULT_GRAPH_APPEARANCE.nodes?.pathGroup,
      color:
        appearance?.nodes?.pathGroup?.color ||
        DEFAULT_GRAPH_APPEARANCE.nodes?.pathGroup?.color,
      radius:
        appearance?.nodes?.pathGroup?.radius ??
        DEFAULT_GRAPH_APPEARANCE.nodes?.pathGroup?.radius,
    },
    callback: {
      ...DEFAULT_GRAPH_APPEARANCE.nodes?.callback,
      color:
        legacy.callbackNode ||
        appearance?.nodes?.callback?.color ||
        DEFAULT_GRAPH_APPEARANCE.nodes?.callback?.color,
      radius:
        appearance?.nodes?.callback?.radius ??
        DEFAULT_GRAPH_APPEARANCE.nodes?.callback?.radius,
    },
    state: {
      ...DEFAULT_GRAPH_APPEARANCE.nodes?.state,
      color:
        legacy.stateNode ||
        appearance?.nodes?.state?.color ||
        DEFAULT_GRAPH_APPEARANCE.nodes?.state?.color,
      radius:
        appearance?.nodes?.state?.radius ??
        DEFAULT_GRAPH_APPEARANCE.nodes?.state?.radius,
    },
    memo: {
      ...DEFAULT_GRAPH_APPEARANCE.nodes?.memo,
      color:
        legacy.memoNode ||
        appearance?.nodes?.memo?.color ||
        DEFAULT_GRAPH_APPEARANCE.nodes?.memo?.color,
      radius:
        appearance?.nodes?.memo?.radius ??
        DEFAULT_GRAPH_APPEARANCE.nodes?.memo?.radius,
    },
    ref: {
      ...DEFAULT_GRAPH_APPEARANCE.nodes?.ref,
      color:
        legacy.refNode ||
        appearance?.nodes?.ref?.color ||
        DEFAULT_GRAPH_APPEARANCE.nodes?.ref?.color,
      radius:
        appearance?.nodes?.ref?.radius ??
        DEFAULT_GRAPH_APPEARANCE.nodes?.ref?.radius,
    },
    effect: {
      ...DEFAULT_GRAPH_APPEARANCE.nodes?.effect,
      color:
        legacy.effectNode ||
        appearance?.nodes?.effect?.color ||
        DEFAULT_GRAPH_APPEARANCE.nodes?.effect?.color,
      radius:
        appearance?.nodes?.effect?.radius ??
        DEFAULT_GRAPH_APPEARANCE.nodes?.effect?.radius,
    },
    prop: {
      ...DEFAULT_GRAPH_APPEARANCE.nodes?.prop,
      color:
        legacy.propNode ||
        appearance?.nodes?.prop?.color ||
        DEFAULT_GRAPH_APPEARANCE.nodes?.prop?.color,
      radius:
        appearance?.nodes?.prop?.radius ??
        DEFAULT_GRAPH_APPEARANCE.nodes?.prop?.radius,
    },
    render: {
      ...DEFAULT_GRAPH_APPEARANCE.nodes?.render,
      color:
        legacy.renderNode ||
        appearance?.nodes?.render?.color ||
        DEFAULT_GRAPH_APPEARANCE.nodes?.render?.color,
      radius:
        appearance?.nodes?.render?.radius ??
        DEFAULT_GRAPH_APPEARANCE.nodes?.render?.radius,
    },
  };

  return {
    ...DEFAULT_GRAPH_APPEARANCE,
    ...appearance,
    nodes,
  };
}

export interface GraphItemPosition {
  x: number;
  y: number;
}

export interface AppearanceOverride {
  color?: string;
  radius?: number;
  collapsedRadius?: number;
  expandedRadius?: number;
}

export interface GraphNodeDetail {
  id: string;
  projectPath?: string;
  fileName?: string;
  pureFileName?: string;
  loc?: { line: number; column: number };
  declarationKind?: "const" | "let" | "var" | "using" | "await using";
  tag?: string;
  componentType?: "function" | "class" | string | null;
  raw?: ComponentFileVar;
  [key: string]: unknown;
}

export interface GraphNodeData {
  id: string;
  name: VariableName | string;
  label?: { text: string; fill?: string };
  type?: string;
  radius?: number;
  color?: string;
  combo?: string;
  gitStatus?: "added" | "modified" | "deleted";
  appearanceOverride?: AppearanceOverride;
  displayName?: string;
  hasProps?: boolean;
  hasHooks?: boolean;
  hasChildren?: boolean;
  pureFileName?: string;
  scope?: string;
  [key: string]: unknown;
}

export interface GraphComboData extends GraphNodeData {
  collapsed?: boolean;
  collapsedRadius?: number;
  expandedRadius?: number;
  padding?: number;
  appearanceOverride?: AppearanceOverride;
  [key: string]: unknown;
}

export interface GraphArrowData {
  id: string;
  source: string;
  target: string;
  label?: string;
  edgeKind?: string;
  category?: string;
  flowRole?: "direct" | "side-effect" | null;
  usageCount?: number;
  usages?: UsageOccurrence[];
  highlighted?: boolean;
  dimmed?: boolean;
  opensTo?: { fileName: string; line: number; column: number };
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
  details?: Record<string, GraphNodeDetail>;
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
  /**
   * Request-scoped cache for aggregated task data so multiple tasks do not reread SQLite.
   */
  taskDataCache?: DatabaseData;
  /**
   * Optional stage profiler provided by the caller.
   */
  profileStage?: (
    name: string,
    startedAt: number,
    detail?: string,
  ) => void | Promise<void>;
}

/**
 * Helper to retrieve required graph data from either TaskContext.snapshotData or TaskContext.db.
 * It handles workspace databases and qualifies IDs to avoid collisions.
 */
export function getTaskData(context: TaskContext): DatabaseData {
  const { db, snapshotData, analysisPaths, taskDataCache } = context;

  if (snapshotData) {
    return snapshotData;
  }

  if (taskDataCache) {
    return taskDataCache;
  }

  if (!db) {
    const empty = {
      files: [],
      entities: [],
      scopes: [],
      symbols: [],
      renders: [],
      exports: [],
      relations: [],
    };
    context.taskDataCache = empty;
    return empty;
  }

  const existingTables = new Set(
    (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type IN ('table', 'view')",
        )
        .all() as { name: string }[]
    ).map((row) => row.name),
  );
  const tableExists = (name: string) => existingTables.has(name);

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

        const pkgExistingTables = new Set(
          (
            pkgDb
              .prepare(
                "SELECT name FROM sqlite_master WHERE type IN ('table', 'view')",
              )
              .all() as { name: string }[]
          ).map((row) => row.name),
        );
        const pkgTableExists = (name: string) => pkgExistingTables.has(name);

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

    context.taskDataCache = aggregated;
    return aggregated;
  }

  // Single project database fallback
  const hasPackages = tableExists("packages");
  const hasDeps = tableExists("package_dependencies");
  const hasExports = tableExists("exports");

  const singleProjectData = {
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
  context.taskDataCache = singleProjectData;
  return singleProjectData;
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
  detail?: GraphNodeDetail;
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
