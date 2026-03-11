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
  type DatabaseData,
  type EntityRow,
  type SymbolRow,
  type RenderRow,
  type AnalyzedDiff,
} from "shared";

import { useConfigStore } from "@/hooks/use-config-store";
import { useVirtualizer } from "@tanstack/react-virtual";

interface GitChangeTreeProps {
  data: DatabaseData;
  onLocate?: (id: string) => void;
}

type ChangeItemType = EntityRow | SymbolRow | RenderRow;

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
      item: ChangeItemType;
      depth: number;
      hasChildren: boolean;
      isDeleted: boolean;
      isAdded: boolean;
      isModified: boolean;
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
      data.files.forEach((f) => initialExpanded.add(f.path));
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

    // Find all unique files that have changes
    const changedFileIds = new Set<number>();
    
    const findFileForEntity = (entityId: string) => {
        const entity = data.entities.find(e => e.id === entityId);
        if (!entity) return null;
        const scope = data.scopes.find(s => s.id === entity.scope_id);
        return scope?.file_id;
    };

    const findFileForSymbol = (symbolId: string) => {
        const symbol = data.symbols.find(s => s.id === symbolId);
        if (!symbol) return null;
        const scope = data.scopes.find(s => s.id === symbol.scope_id);
        return scope?.file_id;
    };

    diff.added.forEach(id => {
        const fid = findFileForEntity(id) || findFileForSymbol(id);
        if (fid != null) changedFileIds.add(fid);
    });
    diff.modified.forEach(id => {
        const fid = findFileForEntity(id) || findFileForSymbol(id);
        if (fid != null) changedFileIds.add(fid);
    });
    diff.deleted.forEach(id => {
        const fid = findFileForEntity(id) || findFileForSymbol(id);
        if (fid != null) changedFileIds.add(fid);
    });

    const changedFiles = data.files.filter(f => changedFileIds.has(f.id)).sort((a,b) => a.path.localeCompare(b.path));

    for (const file of changedFiles) {
      const fileId = file.path;
      const isExpanded = expandedIds.has(fileId);
      
      const fileEntities = data.entities.filter(e => {
          const scope = data.scopes.find(s => s.id === e.scope_id);
          return scope?.file_id === file.id;
      }).filter(e => diffSets.added.has(e.id) || diffSets.modified.has(e.id) || diffSets.deleted.has(e.id));

      result.push({
        type: "file",
        id: fileId,
        key: `file:${fileId}`,
        path: file.path,
        depth: 0,
        hasChildren: fileEntities.length > 0,
        fileName: file.path.split("/").pop() || file.path,
      });

      if (isExpanded) {
        for (const entity of fileEntities) {
          const isAdded = diffSets.added.has(entity.id);
          const isModified = diffSets.modified.has(entity.id);
          const isDeleted = diffSets.deleted.has(entity.id);

          result.push({
            type: "var",
            id: entity.id,
            key: `var:${fileId}:${entity.id}`,
            item: entity,
            depth: 1,
            hasChildren: false,
            isAdded,
            isModified,
            isDeleted,
          });
        }
      }
    }

    return result;
  }, [data, diff, diffSets, expandedIds]);

  const virtualizer = useVirtualizer({
    count: flattenedItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 10,
  });

  if (!diff || flattenedItems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8 text-center space-y-4">
        <div className="p-4 bg-muted/30 rounded-full">
          <Activity className="w-8 h-8 opacity-20" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">No changes detected</p>
          <p className="text-xs opacity-70">
            Select a commit to see the differences
          </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={parentRef} className="h-full overflow-auto custom-scrollbar">
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const item = flattenedItems[virtualItem.index]!;
          return (
            <div
              key={item.key}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: `${virtualItem.size}px`,
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              {item.type === "file" ? (
                <div
                  className="group flex items-center h-full px-2 hover:bg-accent/50 cursor-pointer text-xs border-b border-border/30"
                  onClick={() => toggleExpand(item.id)}
                >
                  <div style={{ width: `${item.depth * 12}px` }} />
                  {item.hasChildren ? (
                    expandedIds.has(item.id) ? (
                      <ChevronDown className="w-3.5 h-3.5 mr-1 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 mr-1 text-muted-foreground" />
                    )
                  ) : (
                    <div className="w-3.5 h-3.5 mr-1" />
                  )}
                  <Database className="w-3.5 h-3.5 mr-1.5 text-blue-400 opacity-70" />
                  <span className="truncate font-medium flex-1">
                    {item.fileName}
                  </span>
                </div>
              ) : (
                <div
                  className={cn(
                    "group flex items-center h-full px-2 hover:bg-accent/50 cursor-pointer text-xs",
                    item.isAdded && "text-green-500 bg-green-500/5",
                    item.isDeleted && "text-red-500 bg-red-500/5 line-through",
                    item.isModified && "text-amber-500 bg-amber-500/5",
                  )}
                  onClick={() => onLocate?.(item.id)}
                >
                  <div style={{ width: `${item.depth * 12 + 16}px` }} />
                  <Box className="w-3.5 h-3.5 mr-1.5 opacity-70" />
                  <span className="truncate flex-1">
                    {"name" in item.item ? item.item.name : "Unknown"}
                  </span>
                  <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {item.isAdded && (
                      <span className="text-[10px] px-1 bg-green-500/20 rounded">
                        A
                      </span>
                    )}
                    {item.isModified && (
                      <span className="text-[10px] px-1 bg-amber-500/20 rounded">
                        M
                      </span>
                    )}
                    {item.isDeleted && (
                      <span className="text-[10px] px-1 bg-red-500/20 rounded">
                        D
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});
