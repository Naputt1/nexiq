import React, { useState } from "react";

interface JsonViewerProps {
  data: unknown;
  label?: string;
  onEdit?: (path: string[], value: unknown) => void;
  level?: number;
  path?: string[];
  search?: string;
  isParentMatch?: boolean;
}

const isObject = (val: unknown): val is Record<string, unknown> =>
  val !== null && typeof val === "object" && !Array.isArray(val);

const hasKeyMatch = (data: unknown, search: string): boolean => {
  if (!data || typeof data !== "object") return false;
  const s = search.toLowerCase();
  const keys = Object.keys(data as Record<string, unknown>);
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase().includes(s)) return true;
  }
  return false;
};

export const JsonViewer: React.FC<JsonViewerProps> = ({
  data,
  label,
  onEdit,
  level = 0,
  path = [],
  search = "",
  isParentMatch = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(level < 2);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [localSearch, setLocalSearch] = useState("");
  const [prevActiveSearch, setPrevActiveSearch] = useState<string | undefined>(
    undefined,
  );

  const activeSearch = localSearch || search;

  // Adjust state during render when search changes, avoiding useEffect cascading renders
  if (activeSearch !== prevActiveSearch) {
    setPrevActiveSearch(activeSearch);
    if (activeSearch && hasKeyMatch(data, activeSearch)) {
      setIsExpanded(true);
    }
  }

  const handleEdit = () => {
    if (!onEdit) return;
    setIsEditing(true);
    setEditValue(JSON.stringify(data));
  };

  const handleSave = () => {
    try {
      const parsed: unknown = JSON.parse(editValue);
      onEdit?.(path, parsed);
      setIsEditing(false);
    } catch {
      // if it's a string, try treating it as a string
      if (typeof data === "string") {
        onEdit?.(path, editValue);
        setIsEditing(false);
        return;
      }
      alert("Invalid JSON");
    }
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-2 text-xs font-mono ml-4">
        {label && <span className="text-blue-400">{label}:</span>}
        <input
          className="bg-zinc-800 text-white border border-zinc-600 px-1 rounded"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") setIsEditing(false);
          }}
          autoFocus
        />
        <button onClick={handleSave} className="text-green-500">
          Save
        </button>
        <button onClick={() => setIsEditing(false)} className="text-red-500">
          Cancel
        </button>
      </div>
    );
  }

  if (isObject(data) || Array.isArray(data)) {
    const dataObj = data as Record<string, unknown> | unknown[];
    const entries = Object.entries(dataObj);
    const isEmpty = entries.length === 0;
    const isArray = Array.isArray(data);
    const preview = isArray ? `Array(${data.length})` : "{...}";

    const labelMatches =
      activeSearch && label?.toLowerCase().includes(activeSearch.toLowerCase());
    const currentMatch = isParentMatch || labelMatches;

    if (
      activeSearch &&
      !localSearch &&
      !currentMatch &&
      !hasKeyMatch(data, activeSearch) &&
      path.length > 0
    ) {
      return null;
    }

    return (
      <div className="text-xs font-mono">
        <div
          className="flex items-center gap-1 cursor-pointer hover:bg-white/5 active:bg-white/10 px-1 rounded group"
          onClick={() => setIsExpanded(!isExpanded)}
          style={{ marginLeft: level * 8 }}
        >
          <span className="text-zinc-500 w-3 inline-block">
            {isEmpty ? "" : isExpanded ? "▼" : "▶"}
          </span>
          {label && <span className="text-blue-400 mr-1">{label}:</span>}
          <span className="text-zinc-400">{preview}</span>

          {isExpanded && !isEmpty && (
            <input
              className={`ml-2 bg-zinc-800 text-white border px-1 rounded h-4 text-[10px] w-24 outline-none transition-all ${
                localSearch
                  ? "border-blue-500 opacity-100"
                  : "border-zinc-700 opacity-0 group-hover:opacity-100 focus:opacity-100"
              }`}
              placeholder="filter keys..."
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            />
          )}
        </div>
        {isExpanded && !isEmpty && (
          <div>
            {entries.map(([key, value]) => {
              const keyMatches =
                activeSearch &&
                key.toLowerCase().includes(activeSearch.toLowerCase());
              const childVisible =
                currentMatch ||
                !activeSearch ||
                keyMatches ||
                hasKeyMatch(value, activeSearch);

              if (!childVisible) return null;

              return (
                <JsonViewer
                  key={key}
                  data={value}
                  label={key}
                  onEdit={onEdit}
                  level={level + 1}
                  path={[...path, key]}
                  search={activeSearch}
                  isParentMatch={Boolean(currentMatch || keyMatches)}
                />
              );
            })}
          </div>
        )}
      </div>
    );
  }

  if (
    activeSearch &&
    !isParentMatch &&
    label &&
    !label.toLowerCase().includes(activeSearch.toLowerCase())
  ) {
    return null;
  }

  const renderValue = () => {
    if (typeof data === "string")
      return <span className="text-green-300">"{data}"</span>;
    if (typeof data === "number")
      return <span className="text-orange-300">{data}</span>;
    if (typeof data === "boolean")
      return <span className="text-purple-300">{String(data)}</span>;
    if (data === null) return <span className="text-zinc-500">null</span>;
    if (data === undefined)
      return <span className="text-zinc-500">undefined</span>;
    return <span className="text-zinc-300">{String(data)}</span>;
  };

  return (
    <div
      className="flex items-center gap-2 text-xs font-mono hover:bg-white/5 px-1 rounded group"
      style={{ marginLeft: level * 8 + 12 }}
    >
      {label && <span className="text-blue-400">{label}:</span>}
      <div className="flex-1 truncate cursor-text" onDoubleClick={handleEdit}>
        {renderValue()}
      </div>
      {onEdit && (
        <button
          onClick={handleEdit}
          className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-white"
        >
          ✎
        </button>
      )}
    </div>
  );
};
