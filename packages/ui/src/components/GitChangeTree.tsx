import { useState, useMemo } from "react";
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

interface GitChangeTreeProps {
  data: JsonData;
  onLocate?: (id: string) => void;
}

export function GitChangeTree({ data, onLocate }: GitChangeTreeProps) {
  const diff = data.diff;
  const { customColors } = useConfigStore();

  const allFiles = useMemo(() => {
    if (!diff) return [];
    const files = new Set(Object.keys(data.files));
    if (diff.deletedObjects) {
      Object.values(diff.deletedObjects).forEach((obj) => {
        const fileObj = obj as { file?: string };
        if (fileObj.file) {
          files.add(fileObj.file);
        }
      });
    }
    return Array.from(files).sort();
  }, [data, diff]);

  const changedFiles = useMemo(() => {
    if (!diff) return [];
    return allFiles.filter((path) => {
      const currentVars = data.files[path]?.var || {};
      const hasCurrentChanges = Object.values(currentVars).some((v) =>
        hasChanges(v, diff),
      );
      if (hasCurrentChanges) return true;

      const hasDeletedInFile =
        diff.deletedObjects &&
        Object.values(diff.deletedObjects).some((obj) => {
          const fileObj = obj as { file?: string };
          return fileObj.file === path && !obj.id.includes(":"); // Only top-level deleted vars in file
        });
      return !!hasDeletedInFile;
    });
  }, [allFiles, data, diff]);

  if (!diff)
    return (
      <div className="p-4 text-xs text-muted-foreground text-center">
        No structural changes detected.
      </div>
    );

  return (
    <div className="space-y-1">
      {changedFiles.map((path) => (
        <FileNode
          key={path}
          path={path}
          vars={data.files[path]?.var || {}}
          diff={diff}
          onLocate={onLocate}
        />
      ))}
    </div>
  );
}

function hasChanges(
  item: ComponentFileVar | PropData | EffectInfo,
  diff: AnalyzedDiff,
): boolean {
  if (
    diff.added.includes(item.id) ||
    diff.modified.includes(item.id) ||
    diff.deleted.includes(item.id)
  ) {
    return true;
  }

  // Check current children
  if ("var" in item && item.var) {
    if (Object.values(item.var).some((v) => hasChanges(v, diff))) return true;
  }

  if ("props" in item && item.props) {
    if (item.props.some((p) => hasChanges(p, diff))) return true;
  }

  if ("effects" in item && item.effects) {
    if (Object.values(item.effects).some((e) => hasChanges(e, diff)))
      return true;
  }

  // Check if any deleted item claims this as parent
  if (diff.deletedObjects) {
    return Object.values(diff.deletedObjects).some((obj) => {
      const objAny = obj as { parentId?: string };
      if (objAny.parentId === item.id) return true;
      // Props and effects often use ID prefixing
      if (obj.id.startsWith(item.id + ":")) {
        const suffix = obj.id.substring(item.id.length + 1);
        // It's a direct child if it doesn't have further nesting colons
        // (excluding the 'prop:' or 'render:' prefixes themselves)
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

function FileNode({
  path,
  vars,
  diff,
  onLocate,
}: {
  path: string;
  vars: Record<string, ComponentFileVar>;
  diff: AnalyzedDiff;
  onLocate?: (id: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const fileName = path.split("/").pop() || path;

  const topLevelChanges = useMemo(() => {
    const items: (ComponentFileVar | PropData | EffectInfo)[] = [];

    // Current changed vars
    Object.values(vars).forEach((v) => {
      if (hasChanges(v, diff)) items.push(v);
    });

    // Deleted items that belong to this file and don't have a parent
    if (diff.deletedObjects) {
      Object.values(diff.deletedObjects).forEach((obj) => {
        const objAny = obj as { file?: string; parentId?: string };
        if (objAny.file === path) {
          const hasParent = objAny.parentId || obj.id.includes(":");
          if (!hasParent) {
            items.push(obj);
          }
        }
      });
    }

    return items;
  }, [vars, diff, path]);

  return (
    <div>
      <div
        className="flex items-center gap-1 px-2 py-1 hover:bg-accent rounded cursor-pointer group"
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        )}
        <span className="text-xs font-medium truncate flex-1" title={path}>
          {fileName}
        </span>
      </div>
      {isOpen && (
        <div className="ml-4 space-y-1 mt-1">
          {topLevelChanges.map((item) => (
            <VarNode
              key={item.id}
              item={item as ComponentFileVar}
              diff={diff}
              onLocate={onLocate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function VarNode({
  item,
  diff,
  depth = 0,
  onLocate,
}: {
  item: ComponentFileVar;
  diff: AnalyzedDiff;
  depth?: number;
  onLocate?: (id: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(depth === 0);
  const { customColors } = useConfigStore();
  const isAdded = diff.added.includes(item.id);
  const isModified = diff.modified.includes(item.id);
  const isDeleted = diff.deleted.includes(item.id);

  const statusStyle = useMemo(() => {
    if (!customColors) return {};
    if (isAdded) return { color: customColors.gitAdded || "#22c55e" };
    if (isModified) return { color: customColors.gitModified || "#f59e0b" };
    if (isDeleted) return { color: customColors.gitDeleted || "#ef4444" };
    return {};
  }, [customColors, isAdded, isModified, isDeleted]);

  const children = useMemo(() => {
    const list: (ComponentFileVar | PropData | EffectInfo)[] = [];

    // 1. Current children
    if ("props" in item && item.props) {
      list.push(...item.props.filter((p) => hasChanges(p, diff)));
    }

    if ("effects" in item && item.effects) {
      list.push(
        ...Object.values(item.effects).filter((e) => hasChanges(e, diff)),
      );
    }

    if ("var" in item && item.var) {
      list.push(...Object.values(item.var).filter((v) => hasChanges(v, diff)));
    }

    // 2. Deleted children
    if (diff.deletedObjects) {
      Object.values(diff.deletedObjects).forEach((obj) => {
        const objAny = obj as { parentId?: string };
        if (objAny.parentId === item.id) {
          if (!list.some((existing) => existing.id === obj.id)) {
            list.push(obj);
          }
        }
      });
    }

    return list;
  }, [item, diff]);

  const hasChildren = children.length > 0;

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1 px-2 py-1 hover:bg-accent rounded cursor-pointer group text-xs",
          isAdded && !customColors?.gitAdded && "text-green-500",
          isModified && !customColors?.gitModified && "text-amber-500",
          isDeleted && !customColors?.gitDeleted && "text-red-500",
        )}
        style={statusStyle}
        onClick={() => !isDeleted && onLocate?.(item.id)}
      >
        <div
          className="flex items-center justify-center w-4 h-4 hover:bg-accent-foreground/10 rounded-sm shrink-0"
          onClick={(e) => {
            if (hasChildren) {
              e.stopPropagation();
              setIsOpen(!isOpen);
            }
          }}
        >
          {hasChildren &&
            (isOpen ? (
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
            ))}
        </div>
        <div className="flex items-center gap-1 flex-1 min-w-0">
          <NodeIcon kind={item.kind} className="h-3 w-3 shrink-0" />
          <span
            className="truncate font-medium"
            title={getDisplayName(item.name)}
          >
            {getDisplayName(item.name)}
          </span>
          {isAdded && (
            <span className="text-[10px] ml-1 opacity-70">added</span>
          )}
          {isModified && (
            <span className="text-[10px] ml-1 opacity-70">mod</span>
          )}
          {isDeleted && (
            <span className="text-[10px] ml-1 opacity-70">deleted</span>
          )}
        </div>

        {!isDeleted && (
          <div className="opacity-0 group-hover:opacity-100 transition-opacity">
            <Search className="h-3 w-3 text-muted-foreground" />
          </div>
        )}
      </div>
      {isOpen && hasChildren && (
        <div className="ml-4 space-y-0.5 border-l border-border pl-1 mt-0.5">
          {children.map((child) => (
            <ChildNode
              key={child.id}
              item={child}
              diff={diff}
              onLocate={onLocate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ChildNode({
  item,
  diff,
  onLocate,
}: {
  item: ComponentFileVar | PropData | EffectInfo;
  diff: AnalyzedDiff;
  onLocate?: (id: string) => void;
}) {
  const { customColors } = useConfigStore();
  // If it's a ComponentFileVar, use VarNode recursively
  if (
    "kind" in item &&
    (item.kind === "component" ||
      item.kind === "hook" ||
      item.kind === "state" ||
      item.kind === "ref" ||
      item.kind === "memo" ||
      item.kind === "callback" ||
      item.kind === "normal")
  ) {
    return (
      <VarNode
        item={item as ComponentFileVar}
        diff={diff}
        depth={1}
        onLocate={onLocate}
      />
    );
  }

  // Otherwise it's a Prop or Effect
  const isAdded = diff.added.includes(item.id);
  const isModified = diff.modified.includes(item.id);
  const isDeleted = diff.deleted.includes(item.id);

  const statusStyle = {
    color: isAdded
      ? customColors?.gitAdded || "#22c55e"
      : isModified
        ? customColors?.gitModified || "#f59e0b"
        : isDeleted
          ? customColors?.gitDeleted || "#ef4444"
          : undefined,
  };

  let name = "";
  let kind = "";
  if ("name" in item && typeof item.name === "string") {
    name = item.name;
    kind = "prop";
  } else if (item.id.includes(":effect:")) {
    name = "effect";
    kind = "effect";
  } else if ("kind" in item && item.kind === "spread") {
    name = (item as PropData).name;
    kind = "spread";
  }

  return (
    <div
      className={cn(
        "flex items-center gap-1 px-2 py-0.5 hover:bg-accent rounded text-[11px] group cursor-pointer",
        isAdded && !customColors?.gitAdded && "text-green-500",
        isModified && !customColors?.gitModified && "text-amber-500",
        isDeleted && !customColors?.gitDeleted && "text-red-500",
      )}
      style={statusStyle}
      onClick={() => !isDeleted && onLocate?.(item.id)}
    >
      <div className="w-4" />
      <NodeIcon kind={kind} className="h-3 w-3 shrink-0" />
      <span className="truncate flex-1" title={name}>
        {name}
      </span>
      {!isDeleted && (
        <div className="opacity-0 group-hover:opacity-100 transition-opacity">
          <Search className="h-3 w-3 text-muted-foreground" />
        </div>
      )}
    </div>
  );
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

