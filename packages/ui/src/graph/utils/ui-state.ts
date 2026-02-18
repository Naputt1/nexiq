import { type GraphData } from "../hook";
import { type UIStateMap } from "shared";

/**
 * Extracts all relevant UI state (positions, radii, layout status) from the graph.
 * This includes nodes and combos at all levels.
 */
export function extractUIState(graph: GraphData): UIStateMap {
  const state: UIStateMap = {};

  // Extract from all nodes
  graph.getAllNodes().forEach((n) => {
    state[n.id] = {
      x: n.x,
      y: n.y,
      radius: n.radius,
      isLayoutCalculated: n.isLayoutCalculated,
    };
  });

  // Extract from all combos
  graph.getAllCombos().forEach((c) => {
    state[c.id] = {
      x: c.x,
      y: c.y,
      radius: c.radius,
      collapsedRadius: c.collapsedRadius,
      // For combos, expandedRadius represents the full calculated size including children
      expandedRadius: c.expandedRadius,
      isLayoutCalculated: c.isLayoutCalculated,
      collapsed: c.collapsed,
    };
  });

  return state;
}
