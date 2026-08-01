export type RouteFramework = "nextjs" | "tanstack" | "react-router";

export type RouteType =
  | "page"
  | "layout"
  | "loading"
  | "error"
  | "not-found"
  | "template"
  | "route"
  | "root"
  | "default";

export type RouteKind =
  | "static"
  | "dynamic"
  | "catch-all"
  | "optional-catch-all";

export type RouteLinkType =
  | "Link"
  | "useNavigate"
  | "navigate"
  | "redirect";

/**
 * A single route node in the router graph. Routes form a tree via
 * `parent_route_id`. Rows are written by a framework-specific route scanner
 * (extension) into the cache database after analysis.
 */
export interface RouteRow {
  id: string;
  framework: RouteFramework;
  path_pattern: string;
  route_type: RouteType;
  route_kind: RouteKind;
  file_path: string | null;
  component_symbol_id: string | null;
  parent_route_id: string | null;
  params: string | null;
  priority: number;
  data_json: string | null;
}

/**
 * A navigation reference from a component to a route (Link/navigate calls).
 */
export interface RouteLinkRow {
  id: string;
  from_entity_id: string | null;
  to_route_id: string | null;
  path_pattern: string | null;
  link_type: RouteLinkType;
  line: number | null;
  column: number | null;
  file_path: string | null;
  data_json: string | null;
}

/**
 * Structured metadata stored as JSON in RouteRow.data_json.
 */
export interface RouteData {
  /** Full normalized path, e.g. "/dashboard/users/[id]" */
  fullPath: string;
  /** URL segments excluding dynamic markers, e.g. ["dashboard", "users"] */
  segmentNames: string[];
  /** Dynamic param names in order, e.g. ["id"] */
  dynamicParams: string[];
  /** Route groups (Next.js `(group)`), excluded from the URL */
  groupNames?: string[];
  /** Parallel route slots (Next.js `@slot`) */
  parallelSlots?: string[];
  /** Named exports or options present on the route definition */
  flags?: string[];
  /** Whether the route has a data loader (TanStack loader / Next generateStaticParams) */
  hasLoader?: boolean;
  /** Whether the route component receives `searchParams` */
  hasSearchParams?: boolean;
  /** Whether the route component receives `params` */
  hasParams?: boolean;
}
