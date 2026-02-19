import { type JsonData } from "shared";
import {
  type GraphComboData,
  type GraphNodeData,
  type GraphViewResult,
  type GraphViewTask,
} from "../index.js";

/**
 * Task that applies Git status (added, modified, deleted) to nodes and combos.
 * This runs after the base graph has been generated.
 */
export const gitTask: GraphViewTask = {
  id: "git-status",
  priority: 100, // Run late to ensure all nodes/combos are present
  run: (graphData: JsonData, result: GraphViewResult): GraphViewResult => {
    const { added = [], modified = [], deleted = [] } = graphData.diff || {};

    // Skip if no diff data
    if (added.length === 0 && modified.length === 0 && deleted.length === 0) {
      return result;
    }

    const combos = [...result.combos];
    const nodes = [...result.nodes];

    const applyStatus = (item: GraphComboData | GraphNodeData) => {
      // Find the base ID for mapping (e.g., stripping '-render-instanceId')
      let baseId = item.id;
      if (item.id.includes("-render-")) {
        baseId = item.id.split("-render-")[0]!;
      } else if (item.id.includes("-props")) {
        baseId = item.id.split("-props")[0]!;
      } else if (item.id.includes(":")) {
        // Handle virtual variables (parent:id)
        baseId = item.id.split(":")[0]!;
      }

      if (added.includes(item.id) || added.includes(baseId)) {
        item.gitStatus = "added";
      } else if (modified.includes(item.id) || modified.includes(baseId)) {
        item.gitStatus = "modified";
      } else if (deleted.includes(item.id) || deleted.includes(baseId)) {
        item.gitStatus = "deleted";
      }
    };

    nodes.forEach(applyStatus);
    combos.forEach(applyStatus);

    // Aggregate statuses for specialized combos (like 'props')
    combos.forEach((combo) => {
      if (combo.id.endsWith("-props")) {
        const childStatuses = [
          ...nodes
            .filter((n) => n.combo === combo.id)
            .map((n) => n.gitStatus),
          ...combos
            .filter((c) => c.combo === combo.id)
            .map((c) => c.gitStatus),
        ].filter(Boolean);

        if (childStatuses.length > 0) {
          const unique = new Set(childStatuses);
          if (unique.size === 1) {
            combo.gitStatus = childStatuses[0] as
              | "added"
              | "modified"
              | "deleted";
          } else {
            combo.gitStatus = "modified";
          }
        }
      }
    });

    return {
      ...result,
      nodes,
      combos,
    };
  },
};
