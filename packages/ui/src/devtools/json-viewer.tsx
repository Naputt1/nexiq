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
  const [searchKeysOnly, setSearchKeysOnly] = useState(false);
  const [localFilters, setLocalFilters] = useState<Record<string, string>>({});
  const [activeSearchPaths, setActiveSearchPaths] = useState<Set<string>>(new Set());
  const parentRef = useRef<HTMLDivElement>(null);

  // Initial expansion for first 2 levels
  useEffect(() => {
    if (expandedPaths.size <= 1 && (isObject(data) || Array.isArray(data))) {
      const initialExpanded = new Set(["root"]);
      const entries = Object.entries(data as Record<string, unknown>);
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

  const toggleLocalSearch = (id: string) => {
    setActiveSearchPaths((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        // Clear filter when closing search
        setLocalFilters((f) => {
          const { [id]: _, ...rest } = f;
          return rest;
        });
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const collapseAll = () => {
    setExpandedPaths(new Set(["root"]));
    setLocalFilters({});
    setActiveSearchPaths(new Set());
  };

  const { flattenedData } = useMemo(() => {
    const items: FlattenedItem[] = [];
    const matchSet = new Set<string>();
    const branchHasMatch = new Set<string>();
    const searchLower = search.toLowerCase();

    if (!data) return { flattenedData: [] };

    // Pass 1: Find all direct matches (for global search)
    const findMatches = (val: unknown, key: string, path: string[]) => {
      const id = path.join(".");
      const keyMatch = key.toLowerCase().includes(searchLower);
      const valueMatch =
        !searchKeysOnly &&
        (typeof val === "string" || typeof val === "number" || typeof val === "boolean") &&
        String(val).toLowerCase().includes(searchLower);

      if (search && (keyMatch || valueMatch)) {
        matchSet.add(id);
        // Mark all ancestors as having a match in branch
        for (let i = 1; i <= path.length; i++) {
          branchHasMatch.add(path.slice(0, i).join("."));
        }
      }

      if (isObject(val)) {
        Object.entries(val).forEach(([k, v]) => {
          findMatches(v, k, [...path, k]);
        });
      } else if (Array.isArray(val)) {
        val.forEach((v, i) => {
          findMatches(v, String(i), [...path, String(i)]);
        });
      }
    };

    if (search) {
      findMatches(data, label || "root", ["root"]);
    }

    // Pass 2: Flatten based on expansion and search (global + local)
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
          : Object.keys(val as Record<string, unknown>).length === 0
        : true;

      const isExpanded = expandedPaths.has(id) || (!!search && branchHasMatch.has(id));

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

      if (search && !matchSet.has(id) && !branchHasMatch.has(id)) {
        return;
      }

      items.push(item);

      if (canExpand && isExpanded && !isEmpty) {
        const localFilter = localFilters[id]?.toLowerCase();
        if (isArray) {
          (val as unknown[]).forEach((v, i) => {
            if (!localFilter || String(i).includes(localFilter)) {
              flatten(v, String(i), [...path, String(i)], level + 1);
            }
          });
        } else {
          Object.entries(val as Record<string, unknown>).forEach(([k, v]) => {
            if (!localFilter || k.toLowerCase().includes(localFilter)) {
              flatten(v, k, [...path, k], level + 1);
            }
          });
        }
      }
    };

    flatten(data, label || "root", ["root"], 0);
    return { flattenedData: items, matchSet };
  }, [data, label, expandedPaths, search, searchKeysOnly, localFilters]);

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
      <div className="p-1 border-b border-zinc-800 flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <input
            className="bg-zinc-900 text-white border border-zinc-700 px-2 py-0.5 rounded text-xs w-full outline-none focus:border-blue-500"
            placeholder="Global Search..."
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
        <div className="flex items-center gap-2 px-1">
          <label className="flex items-center gap-1 text-[10px] text-zinc-500 cursor-pointer hover:text-zinc-300">
            <input
              type="checkbox"
              checked={searchKeysOnly}
              onChange={(e) => setSearchKeysOnly(e.target.checked)}
              className="w-3 h-3 rounded border-zinc-700 bg-zinc-900"
            />
            Keys only
          </label>
        </div>
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
            const isLocalSearchActive = activeSearchPaths.has(item.id);

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
                    <HighlightedText text={item.key} highlight={search} />:
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
                        highlight={search}
                      />
                      <div
                        className={`flex items-center gap-1 transition-opacity ${
                          search || isLocalSearchActive || localFilters[item.id]
                            ? "opacity-100"
                            : "opacity-0 group-hover:opacity-100"
                        }`}
                      >
                        {!item.canExpand && onEdit && (
                          <button
                            onClick={() => handleEdit(item.path, item.value)}
                            className="text-zinc-500 hover:text-white"
                          >
                            ✎
                          </button>
                        )}
                        {item.canExpand && item.isExpanded && !item.isEmpty && (
                          <>
                            {isLocalSearchActive ? (
                              <input
                                className="bg-zinc-800 text-white border border-zinc-700 px-1 rounded h-4 text-[10px] outline-none focus:border-blue-500 w-24"
                                placeholder="Filter keys..."
                                value={localFilters[item.id] || ""}
                                onChange={(e) =>
                                  setLocalFilters((prev) => ({
                                    ...prev,
                                    [item.id]: e.target.value,
                                  }))
                                }
                                autoFocus
                                onClick={(e) => e.stopPropagation()}
                              />
                            ) : null}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleLocalSearch(item.id);
                              }}
                              className={`p-0.5 rounded hover:bg-zinc-700 ${
                                isLocalSearchActive || localFilters[item.id]
                                  ? "text-blue-400"
                                  : "text-zinc-500"
                              }`}
                              title="Filter properties"
                            >
                              🔍
                            </button>
                          </>
                        )}
                      </div>
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

const HighlightedText: React.FC<{ text: string; highlight: string }> = ({
  text,
  highlight,
}) => {
  if (!highlight) return <>{text}</>;
  const parts = text.split(new RegExp(`(${highlight})`, "gi"));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === highlight.toLowerCase() ? (
          <mark key={i} className="bg-yellow-500/50 text-white rounded-sm px-px">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
};

const ValueRenderer: React.FC<{
  value: unknown;
  type: FlattenedItem["type"];
  isExpanded: boolean;
  isEmpty: boolean;
  highlight: string;
}> = ({ value, type, isExpanded, isEmpty, highlight }) => {
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
    return (
      <span className="text-green-300">
        "<HighlightedText text={value} highlight={highlight} />"
      </span>
    );
  if (typeof value === "number")
    return (
      <span className="text-orange-300">
        <HighlightedText text={String(value)} highlight={highlight} />
      </span>
    );
  if (typeof value === "boolean")
    return <span className="text-purple-300">{String(value)}</span>;
  if (value === null) return <span className="text-zinc-500">null</span>;
  if (value === undefined)
    return <span className="text-zinc-500">undefined</span>;
  return (
    <span className="text-zinc-300">
      <HighlightedText text={String(value)} highlight={highlight} />
    </span>
  );
};
