import { useEffect, useState, useMemo, useCallback } from "react";
import { useGraphStore } from "../hooks/use-graph-store";
import { JsonViewer } from "./json-viewer";
import type { GraphCombo, GraphNode, GraphArrow } from "../graph/hook";
import { debounce } from "../lib/utils";

interface GraphDataSnapshot {
  nodes: Record<string, unknown>;
  edges: Record<string, unknown>;
  combos: Record<string, unknown>;
  config: unknown;
  projectPath: string | undefined;
  targetPath: string | undefined;
}

const serializeItem = (item: unknown): unknown => {
  if (!item || typeof item !== "object") return item;
  const record = item as Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { parent, child, ...rest } = record;
  const result: Record<string, unknown> = { ...rest };
  if (child && typeof child === "object") {
    const c = child as {
      nodes?: Record<string, unknown>;
      combos?: Record<string, unknown>;
      edges?: Record<string, unknown>;
    };
    result.child = {
      nodes: Object.fromEntries(
        Object.entries(c.nodes || {}).map(([k, v]) => [k, serializeItem(v)]),
      ),
      combos: Object.fromEntries(
        Object.entries(c.combos || {}).map(([k, v]) => [k, serializeItem(v)]),
      ),
      edges: Object.fromEntries(
        Object.entries(c.edges || {}).map(([k, v]) => [k, serializeItem(v)]),
      ),
    };
  }
  return result;
};

export const GraphStatePluginComponent = () => {
  const graphInstance = useGraphStore((s) => s.graphInstance);
  const [graphData, setGraphData] = useState<GraphDataSnapshot | null>(null);

  const updateData = useCallback(() => {
    if (!graphInstance) return;

    const nodes = Object.fromEntries(
      Array.from(
        (graphInstance as unknown as { nodes: Map<string, GraphNode> })[
          "nodes"
        ].entries(),
      ).map(([k, v]) => [k, serializeItem(v)]),
    );
    const edges = Object.fromEntries(
      (graphInstance as unknown as { edges: Map<string, GraphArrow> })["edges"],
    );
    const combos = Object.fromEntries(
      Array.from(
        (graphInstance as unknown as { combos: Map<string, GraphCombo> })[
          "combos"
        ].entries(),
      ).map(([k, v]) => [k, serializeItem(v)]),
    );

    setGraphData({
      nodes,
      edges,
      combos,
      config: (graphInstance as unknown as { config: unknown })["config"],
      projectPath: (graphInstance as unknown as { projectPath?: string })[
        "projectPath"
      ],
      targetPath: (graphInstance as unknown as { targetPath?: string })[
        "targetPath"
      ],
    });
  }, [graphInstance]);

  const debouncedUpdateData = useMemo(
    () => debounce(updateData, 500),
    [updateData],
  );

  useEffect(() => {
    if (!graphInstance) return;

    // Initial update - use a small delay to avoid cascading render warning
    const timeoutId = setTimeout(() => {
      updateData();
    }, 0);

    // Subscribe to all updates
    const unbind = graphInstance.bind(() => {
      debouncedUpdateData();
    });

    return () => {
      clearTimeout(timeoutId);
      graphInstance.unbind(unbind);
    };
  }, [graphInstance, updateData, debouncedUpdateData]);

  const handleEdit = (path: string[], value: unknown) => {
    if (!graphInstance) return;
    graphInstance.updateDataByPath(path, value);
  };

  if (!graphInstance) {
    return (
      <div className="text-zinc-500 p-4">No Graph Instance Available</div>
    );
  }

  return (
    <div className="h-full flex flex-col text-white p-2 overflow-hidden">
      <div className="flex-1 overflow-auto">
        <JsonViewer data={graphData} onEdit={handleEdit} />
      </div>
    </div>
  );
};
