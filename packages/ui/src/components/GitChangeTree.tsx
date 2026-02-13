import { useState, useMemo, useRef, useEffect, memo } from "react";
import {
  ChevronRight,
  ChevronDown,
  Box,
  Webhook,
  Database,
  Link,
  Activity,
  Zap,
  Settings,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getDisplayName,
  type JsonData,
  type ComponentFileVar,
  type PropData,
  type EffectInfo,
  type AnalyzedDiff,
} from "shared";

import { useConfigStore } from "@/hooks/use-config-store";
import { useVirtualizer } from "@tanstack/react-virtual";

interface GitChangeTreeProps {
  data: JsonData;
  onLocate?: (id: string) => void;
}

type FlatItem =
  | {
      type: "file";
      id: string;
      key: string;
      path: string;
      depth: number;
      hasChildren: boolean;
      fileName: string;
    }
  | {
      type: "var";
      id: string;
      key: string;
      item: ComponentFileVar;
      depth: number;
      hasChildren: boolean;
      isDeleted: boolean;
      isAdded: boolean;
      isModified: boolean;
    }
  | {
      type: "child";
      id: string;
      key: string;
      item: ComponentFileVar | PropData | EffectInfo;
      depth: number;
      isDeleted: boolean;
      isAdded: boolean;
      isModified: boolean;
      kind: string;
      name: string;
    };

export const GitChangeTree = memo(function GitChangeTree({
  data,
  onLocate,
}: GitChangeTreeProps) {
  const diff = data.diff;
  const { customColors } = useConfigStore();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const parentRef = useRef<HTMLDivElement>(null);

  // Optimize diff lookups with Sets
  const diffSets = useMemo(() => {
    if (!diff) return null;
    return {
      added: new Set(diff.added),
      modified: new Set(diff.modified),
      deleted: new Set(diff.deleted),
    };
  }, [diff]);

  // Initialize expanded files
  useEffect(() => {
    if (diff) {
      const initialExpanded = new Set<string>();
      Object.keys(data.files).forEach((path) => initialExpanded.add(path));
      // Also expand top-level vars by default
      Object.values(data.files).forEach((f) => {
        Object.values(f.var || {}).forEach((v) => initialExpanded.add(v.id));
      });
      setExpandedIds(initialExpanded);
    }
  }, [data, diff]);

  const toggleExpand = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const flattenedItems = useMemo(() => {
    if (!diff || !diffSets) return [];

    const result: FlatItem[] = [];

    const allFiles = Array.from(
      new Set([
        ...Object.keys(data.files),
        ...(diff.deletedObjects
          ? Object.values(diff.deletedObjects)
              .map((obj) => ("file" in obj ? obj.file : undefined))
              .filter((f): f is string => typeof f === "string")
          : []),
      ]),
    ).sort();

    const changedFiles = allFiles.filter((path) => {
      const currentVars = data.files[path]?.var || {};
      const hasCurrentChanges = Object.values(currentVars).some((v) =>
        hasChanges(v, diff, diffSets),
      );
      if (hasCurrentChanges) return true;

      const hasDeletedInFile =
        diff.deletedObjects &&
        Object.values(diff.deletedObjects).some((obj) => {
          const file = "file" in obj ? obj.file : undefined;
          return file === path && !obj.id.includes(":");
        });
      return !!hasDeletedInFile;
    });

    const getChildren = (
      item: ComponentFileVar,
    ): (ComponentFileVar | PropData | EffectInfo)[] => {
      const list: (ComponentFileVar | PropData | EffectInfo)[] = [];
      if ("props" in item && item.props) {
        list.push(...item.props.filter((p) => hasChanges(p, diff, diffSets)));
      }
      if ("effects" in item && item.effects) {
        list.push(
          ...Object.values(item.effects).filter((e) =>
            hasChanges(e, diff, diffSets),
          ),
        );
      }
      if ("var" in item && item.var) {
        list.push(
          ...Object.values(item.var).filter((v) =>
            hasChanges(v, diff, diffSets),
          ),
        );
      }
      if (diff.deletedObjects) {
        Object.values(diff.deletedObjects).forEach((obj) => {
          const parentId =
            "parentId" in obj
              ? (obj as { parentId?: string }).parentId
              : undefined;
          if (parentId === item.id) {
            if (!list.some((existing) => existing.id === obj.id)) {
              list.push(obj);
            }
          }
        });
      }
      return list;
    };

    const addVarToResult = (
      item: ComponentFileVar,
      depth: number,
      parentKey: string,
    ) => {
      const isAdded = diffSets.added.has(item.id);
      const isModified = diffSets.modified.has(item.id);
      const isDeleted = diffSets.deleted.has(item.id);
      const children = getChildren(item);
      const hasChildren = children.length > 0;
      const key = `${parentKey}-var-${item.id}`;

      result.push({
        type: "var",
        id: item.id,
        key,
        item,
        depth,
        hasChildren,
        isAdded,
        isModified,
        isDeleted,
      });

      if (expandedIds.has(item.id) && hasChildren) {
        children.forEach((child) => {
          if (
            "kind" in child &&
            [
              "component",
              "hook",
              "state",
              "ref",
              "memo",
              "callback",
              "normal",
            ].includes(child.kind!)
          ) {
            addVarToResult(child as ComponentFileVar, depth + 1, key);
          } else {
            let name = "";
            let kind = "";
            if ("name" in child && typeof child.name === "string") {
              name = child.name;
              kind = "prop";
            } else if (child.id.includes(":effect:")) {
              name = "effect";
              kind = "effect";
            } else if ("kind" in child && child.kind === "spread") {
              name = (child as PropData).name;
              kind = "spread";
            }
            result.push({
              type: "child",
              id: child.id,
              key: `${key}-child-${child.id}`,
              item: child,
              depth: depth + 1,
              isAdded: diffSets.added.has(child.id),
              isModified: diffSets.modified.has(child.id),
              isDeleted: diffSets.deleted.has(child.id),
              kind,
              name,
            });
          }
        });
      }
    };

    changedFiles.forEach((path) => {
      const vars = data.files[path]?.var || {};
      const topLevelChanges: (ComponentFileVar | PropData | EffectInfo)[] = [];
      Object.values(vars).forEach((v) => {
        if (hasChanges(v, diff, diffSets)) topLevelChanges.push(v);
      });
      if (diff.deletedObjects) {
        Object.values(diff.deletedObjects).forEach((obj) => {
          const file = "file" in obj ? obj.file : undefined;
          const parentId =
            "parentId" in obj
              ? (obj as { parentId?: string }).parentId
              : undefined;
          if (file === path && !(parentId || obj.id.includes(":"))) {
            topLevelChanges.push(obj);
          }
        });
      }

      const hasChildren = topLevelChanges.length > 0;
      const key = `file-${path}`;
      result.push({
        type: "file",
        id: path,
        key,
        path,
        depth: 0,
        hasChildren,
        fileName: path.split("/").pop() || path,
      });

      if (expandedIds.has(path) && hasChildren) {
        topLevelChanges.forEach((v) =>
          addVarToResult(v as ComponentFileVar, 1, key),
        );
      }
    });

    return result;
  }, [data, diff, diffSets, expandedIds]);

  const virtualizer = useVirtualizer({
    count: flattenedItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 10,
    getItemKey: (index) => flattenedItems[index]?.key || index,
  });

  if (!diff)
    return (
      <div className="p-4 text-xs text-muted-foreground text-center">
        No structural changes detected.
      </div>
    );

  return (
    <div ref={parentRef} className="h-full overflow-auto">
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const item = flattenedItems[virtualItem.index];
          if (!item) return null;

          if (item.type === "file") {
            const isOpen = expandedIds.has(item.id);
            return (
              <div
                key={virtualItem.key}
                className="absolute top-0 left-0 w-full flex items-center gap-1 px-2 py-1 hover:bg-accent rounded cursor-pointer group"
                style={{
                  height: `${virtualItem.size}px`,
                  transform: `translateY(${virtualItem.start}px)`,
                }}
                onClick={() => toggleExpand(item.id)}
              >
                {item.hasChildren ? (
                  isOpen ? (
                    <ChevronDown className="h-3 w-3 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-3 w-3 text-muted-foreground" />
                  )
                ) : (
                  <div className="w-3" />
                )}
                <span
                  className="text-xs font-medium truncate flex-1"
                  title={item.path}
                >
                  {item.fileName}
                </span>
              </div>
            );
          }

          if (item.type === "var") {
            const isOpen = expandedIds.has(item.id);
            const statusStyle = customColors
              ? {
                  color: item.isAdded
                    ? customColors.gitAdded || "#22c55e"
                    : item.isModified
                      ? customColors.gitModified || "#f59e0b"
                      : item.isDeleted
                        ? customColors.gitDeleted || "#ef4444"
                        : undefined,
                }
              : {};

            return (
              <div
                key={virtualItem.key}
                className={cn(
                  "absolute top-0 left-0 w-full flex items-center gap-1 px-2 py-1 hover:bg-accent rounded cursor-pointer group text-xs",
                  item.isAdded && !customColors?.gitAdded && "text-green-500",
                  item.isModified &&
                    !customColors?.gitModified &&
                    "text-amber-500",
                  item.isDeleted && !customColors?.gitDeleted && "text-red-500",
                )}
                style={{
                  height: `${virtualItem.size}px`,
                  transform: `translateY(${virtualItem.start}px)`,
                  paddingLeft: `${item.depth * 12 + 8}px`,
                  ...statusStyle,
                }}
                onClick={() => !item.isDeleted && onLocate?.(item.id)}
              >
                <div
                  className="flex items-center justify-center w-4 h-4 hover:bg-accent-foreground/10 rounded-sm shrink-0"
                  onClick={(e) => item.hasChildren && toggleExpand(item.id, e)}
                >
                  {item.hasChildren &&
                    (isOpen ? (
                      <ChevronDown className="h-3 w-3 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-3 w-3 text-muted-foreground" />
                    ))}
                </div>
                <div className="flex items-center gap-1 flex-1 min-w-0">
                  <NodeIcon
                    kind={item.item.kind}
                    className="h-3 w-3 shrink-0"
                  />
                  <span
                    className="truncate font-medium"
                    title={getDisplayName(item.item.name)}
                  >
                    {getDisplayName(item.item.name)}
                  </span>
                  {item.isAdded && (
                    <span className="text-[10px] ml-1 opacity-70">added</span>
                  )}
                  {item.isModified && (
                    <span className="text-[10px] ml-1 opacity-70">mod</span>
                  )}
                  {item.isDeleted && (
                    <span className="text-[10px] ml-1 opacity-70">deleted</span>
                  )}
                </div>
                {!item.isDeleted && (
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                    <Search className="h-3 w-3 text-muted-foreground" />
                  </div>
                )}
              </div>
            );
          }

          if (item.type === "child") {
            const statusStyle = customColors
              ? {
                  color: item.isAdded
                    ? customColors.gitAdded || "#22c55e"
                    : item.isModified
                      ? customColors.gitModified || "#f59e0b"
                      : item.isDeleted
                        ? customColors.gitDeleted || "#ef4444"
                        : undefined,
                }
              : {};

            return (
              <div
                key={virtualItem.key}
                className={cn(
                  "absolute top-0 left-0 w-full flex items-center gap-1 px-2 py-0.5 hover:bg-accent rounded text-[11px] group cursor-pointer",
                  item.isAdded && !customColors?.gitAdded && "text-green-500",
                  item.isModified &&
                    !customColors?.gitModified &&
                    "text-amber-500",
                  item.isDeleted && !customColors?.gitDeleted && "text-red-500",
                )}
                style={{
                  height: `${virtualItem.size}px`,
                  transform: `translateY(${virtualItem.start}px)`,
                  paddingLeft: `${item.depth * 12 + 8}px`,
                  ...statusStyle,
                }}
                onClick={() => !item.isDeleted && onLocate?.(item.id)}
              >
                <div className="w-4" />
                <NodeIcon kind={item.kind} className="h-3 w-3 shrink-0" />
                <span className="truncate flex-1" title={item.name}>
                  {item.name}
                </span>
                {!item.isDeleted && (
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                    <Search className="h-3 w-3 text-muted-foreground" />
                  </div>
                )}
              </div>
            );
          }

          return null;
        })}
      </div>
    </div>
  );
});

function hasChanges(
  item: ComponentFileVar | PropData | EffectInfo,
  diff: AnalyzedDiff,
  sets: { added: Set<string>; modified: Set<string>; deleted: Set<string> },
): boolean {
  if (
    sets.added.has(item.id) ||
    sets.modified.has(item.id) ||
    sets.deleted.has(item.id)
  ) {
    return true;
  }

  if ("var" in item && item.var) {
    if (Object.values(item.var).some((v) => hasChanges(v, diff, sets)))
      return true;
  }

  if ("props" in item && item.props) {
    if (item.props.some((p) => hasChanges(p, diff, sets))) return true;
  }

  if ("effects" in item && item.effects) {
    if (Object.values(item.effects).some((e) => hasChanges(e, diff, sets)))
      return true;
  }

  if (diff.deletedObjects) {
    return Object.values(diff.deletedObjects).some((obj) => {
      const parentId =
        "parentId" in obj ? (obj as { parentId?: string }).parentId : undefined;
      if (parentId === item.id) return true;
      if (obj.id.startsWith(item.id + ":")) {
        const suffix = obj.id.substring(item.id.length + 1);
        return (
          !suffix.includes(":") ||
          (suffix.startsWith("prop:") && !suffix.substring(5).includes(":")) ||
          (suffix.startsWith("render:") && !suffix.substring(7).includes(":"))
        );
      }
      return false;
    });
  }

  return false;
}

function NodeIcon({ kind, className }: { kind: string; className?: string }) {
  switch (kind) {
    case "component":
      return <Box className={className} />;
    case "hook":
      return <Webhook className={className} />;
    case "state":
      return <Database className={className} />;
    case "ref":
      return <Link className={className} />;
    case "effect":
      return <Activity className={className} />;
    case "memo":
    case "callback":
      return <Zap className={className} />;
    case "prop":
    case "spread":
      return <Settings className={className} />;
    default:
      return <Box className={className} />;
  }
}
