import React, { useState, useMemo, useRef, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

interface JsonViewerProps {
  data: unknown;
  label?: string;
  onEdit?: (path: string[], value: unknown) => void;
}

interface FlattenedItem {
  id: string;
  path: string[];
  key: string;
  value: unknown;
  level: number;
  type: "object" | "array" | "primitive";
  isExpanded: boolean;
  isEmpty: boolean;
  canExpand: boolean;
}

const isObject = (val: unknown): val is Record<string, unknown> =>
  val !== null && typeof val === "object" && !Array.isArray(val);

export const JsonViewer: React.FC<JsonViewerProps> = ({
  data,
  label,
  onEdit,
}) => {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    new Set(["root"]),
  );
  const [search, setSearch] = useState("");
  const parentRef = useRef<HTMLDivElement>(null);

  // Initial expansion for first 2 levels
  useEffect(() => {
    if (expandedPaths.size <= 1 && (isObject(data) || Array.isArray(data))) {
      const initialExpanded = new Set(["root"]);
      const entries = Object.entries(data as object);
      entries.forEach(([key]) => {
        initialExpanded.add(`root.${key}`);
      });
      setExpandedPaths(initialExpanded);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const toggleExpand = (id: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const collapseAll = () => {
    setExpandedPaths(new Set(["root"]));
  };

  const flattenedData = useMemo(() => {
    const items: FlattenedItem[] = [];
    const searchLower = search.toLowerCase();

    const checkMatch = (val: unknown, key: string, depth = 0): boolean => {
      if (!search || depth > 10) return false;
      if (key.toLowerCase().includes(searchLower)) return true;
      if (typeof val === "string" && val.toLowerCase().includes(searchLower))
        return true;
      if (typeof val === "number" && String(val).includes(searchLower))
        return true;
      if (isObject(val)) {
        return Object.entries(val).some(([k, v]) =>
          checkMatch(v, k, depth + 1),
        );
      }
      if (Array.isArray(val)) {
        return val.some((v, i) => checkMatch(v, String(i), depth + 1));
      }
      return false;
    };

    const flatten = (
      val: unknown,
      key: string,
      path: string[],
      level: number,
    ) => {
      const id = path.join(".");
      const isArray = Array.isArray(val);
      const isObj = isObject(val);
      const canExpand = isArray || isObj;
      const isEmpty = canExpand
        ? isArray
          ? (val as unknown[]).length === 0
          : Object.keys(val as object).length === 0
        : true;

      // If searching, we auto-expand if there's a match inside
      const hasMatchInside = search ? checkMatch(val, key) : false;
      const isExpanded = expandedPaths.has(id) || (!!search && hasMatchInside);

      const item: FlattenedItem = {
        id,
        path,
        key,
        value: val,
        level,
        type: isObj ? "object" : isArray ? "array" : "primitive",
        isExpanded,
        isEmpty,
        canExpand,
      };

      const matchesSearch =
        !search ||
        key.toLowerCase().includes(searchLower) ||
        (typeof val === "string" && val.toLowerCase().includes(searchLower)) ||
        (typeof val === "number" && String(val).includes(searchLower));

      // In search mode, we only show if it matches OR if it has a match inside (is a parent of a match)
      if (search && !matchesSearch && !hasMatchInside) {
        return;
      }

      items.push(item);

      if (canExpand && isExpanded && !isEmpty) {
        if (isArray) {
          (val as unknown[]).forEach((v, i) => {
            flatten(v, String(i), [...path, String(i)], level + 1);
          });
        } else {
          Object.entries(val as Record<string, unknown>).forEach(([k, v]) => {
            flatten(v, k, [...path, k], level + 1);
          });
        }
      }
    };

    flatten(data, label || "root", ["root"], 0);
    return items;
  }, [data, label, expandedPaths, search]);

  const virtualizer = useVirtualizer({
    count: flattenedData.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 20,
    overscan: 10,
  });

  const [editingPath, setEditingPath] = useState<string[] | null>(null);
  const [editValue, setEditValue] = useState("");

  const handleEdit = (path: string[], value: unknown) => {
    setEditingPath(path);
    setEditValue(JSON.stringify(value));
  };

  const handleSave = () => {
    if (!editingPath) return;
    try {
      const parsed = JSON.parse(editValue);
      // Remove 'root' from path for onEdit
      onEdit?.(editingPath.slice(1), parsed);
      setEditingPath(null);
    } catch {
      alert("Invalid JSON");
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="p-1 border-b border-zinc-800 flex items-center gap-2">
        <input
          className="bg-zinc-900 text-white border border-zinc-700 px-2 py-0.5 rounded text-xs w-full outline-none focus:border-blue-500"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          onClick={collapseAll}
          className="text-zinc-500 hover:text-white text-[10px] whitespace-nowrap px-1 border border-zinc-700 rounded hover:bg-zinc-800 h-5"
          title="Collapse All"
        >
          Collapse All
        </button>
        {search && (
          <button
            onClick={() => setSearch("")}
            className="text-zinc-500 hover:text-white text-xs"
          >
            Clear
          </button>
        )}
      </div>
      <div ref={parentRef} className="flex-1 overflow-auto">
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const item = flattenedData[virtualItem.index];
            const isEditing = editingPath && editingPath.join(".") === item.id;

            return (
              <div
                key={virtualItem.key}
                className="absolute top-0 left-0 w-full hover:bg-white/5 group"
                style={{
                  height: `${virtualItem.size}px`,
                  transform: `translateY(${virtualItem.start}px)`,
                  paddingLeft: `${item.level * 12}px`,
                }}
              >
                <div className="flex items-center gap-1 text-xs font-mono h-full px-1">
                  {item.canExpand ? (
                    <span
                      className="text-zinc-500 w-3 cursor-pointer select-none"
                      onClick={() => toggleExpand(item.id)}
                    >
                      {item.isEmpty ? "" : item.isExpanded ? "▼" : "▶"}
                    </span>
                  ) : (
                    <span className="w-3" />
                  )}

                  <span
                    className="text-blue-400 cursor-pointer"
                    onClick={() => item.canExpand && toggleExpand(item.id)}
                  >
                    {item.key}:
                  </span>

                  {isEditing ? (
                    <div className="flex items-center gap-1 flex-1">
                      <input
                        className="bg-zinc-800 text-white border border-zinc-600 px-1 rounded flex-1 h-4 outline-none"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSave();
                          if (e.key === "Escape") setEditingPath(null);
                        }}
                        autoFocus
                      />
                    </div>
                  ) : (
                    <div
                      className="flex-1 truncate cursor-text flex items-center gap-2"
                      onDoubleClick={() =>
                        !item.canExpand && handleEdit(item.path, item.value)
                      }
                    >
                      <ValueRenderer
                        value={item.value}
                        type={item.type}
                        isExpanded={item.isExpanded}
                        isEmpty={item.isEmpty}
                      />
                      {!item.canExpand && onEdit && (
                        <button
                          onClick={() => handleEdit(item.path, item.value)}
                          className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-white"
                        >
                          ✎
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const ValueRenderer: React.FC<{
  value: unknown;
  type: FlattenedItem["type"];
  isExpanded: boolean;
  isEmpty: boolean;
}> = ({ value, type, isExpanded, isEmpty }) => {
  if (type === "object") {
    return (
      <span className="text-zinc-400">
        {isExpanded ? "" : isEmpty ? "{}" : "{...}"}
      </span>
    );
  }
  if (type === "array") {
    const arr = value as unknown[];
    return (
      <span className="text-zinc-400">
        {isExpanded ? "" : `Array(${arr.length})`}
      </span>
    );
  }

  if (typeof value === "string")
    return <span className="text-green-300">"{value}"</span>;
  if (typeof value === "number")
    return <span className="text-orange-300">{value}</span>;
  if (typeof value === "boolean")
    return <span className="text-purple-300">{String(value)}</span>;
  if (value === null) return <span className="text-zinc-500">null</span>;
  if (value === undefined)
    return <span className="text-zinc-500">undefined</span>;
  return <span className="text-zinc-300">{String(value)}</span>;
};
