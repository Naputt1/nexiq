import { type DatabaseData } from "@nexiq/shared";
import {
  type GraphComboData,
  type GraphArrowData,
  type GraphNodeData,
  type GraphViewResult,
  type GraphViewTask,
} from "../index.js";

export const componentTask: GraphViewTask = {
  id: "component-structure",
  priority: 10,
  run: (
    data: DatabaseData,
    result: GraphViewResult,
    batch?: Partial<DatabaseData>,
  ): GraphViewResult => {
    const combos: GraphComboData[] = [...result.combos];
    const nodes: GraphNodeData[] = [...result.nodes];
    const edges: GraphArrowData[] = [...result.edges];
    const typeData = { ...result.typeData };

    const entities = batch?.entities || data.entities || [];
    const scopes = batch?.scopes || data.scopes || [];
    const symbols = batch?.symbols || data.symbols || [];
    const relations = batch?.relations || data.relations || [];
    const renders = batch?.renders || data.renders || [];
    const files = data.files || [];

    const fileMap = new Map(files.map((f) => [f.id, f.path]));

    // 1. Map Scopes to Combos
    for (const scope of scopes) {
      if (combos.some((c) => c.id === scope.id)) continue;

      combos.push({
        id: scope.id,
        name: scope.kind,
        label: { text: scope.kind },
        combo: scope.parent_id || undefined,
        type: "scope",
        collapsed: true,
      });
    }

    // 2. Map Symbols to Nodes/Labels
    for (const symbol of symbols) {
      if (
        nodes.some((n) => n.id === symbol.id) ||
        combos.some((c) => c.id === symbol.id)
      )
        continue;

      const entity = data.entities.find((e) => e.id === symbol.entity_id);
      if (!entity) continue;

      const scope = data.scopes.find((s) => s.id === symbol.scope_id);
      const file = scope ? fileMap.get(scope.file_id) : undefined;

      // Check if this symbol's entity has an associated block scope (the body)
      const blockScope = data.scopes.find(
        (s) => s.entity_id === entity.id && s.kind === "block",
      );

      if (blockScope) {
        // This symbol represents a scope (e.g. function body)
        // We update the combo created for this scope
        const combo = combos.find((c) => c.id === blockScope.id);
        if (combo) {
          combo.label = { text: symbol.name };
          combo.displayName = symbol.name;
          combo.type = entity.kind;
          combo.fileName = file;
          combo.loc = { line: entity.line || 0, column: entity.column || 0 };
        }
      } else {
        // Just a variable, create a node
        nodes.push({
          id: symbol.id,
          name: symbol.name,
          label: { text: symbol.name },
          combo: symbol.scope_id,
          type: entity.kind,
          fileName: file,
          loc: { line: entity.line || 0, column: entity.column || 0 },
          displayName: symbol.name,
          radius: 10,
        });
      }
    }

    // 3. Handle Renders (JSX)
    for (const render of renders) {
      if (
        nodes.some((n) => n.id === render.id) ||
        combos.some((c) => c.id === render.id)
      )
        continue;

      const file = fileMap.get(render.file_id);
      const parentCombo =
        render.parent_render_id ||
        data.scopes.find(
          (s) => s.entity_id === render.parent_entity_id && s.kind === "block",
        )?.id;

      const commonData = {
        id: render.id,
        name: render.tag,
        label: { text: render.tag },
        combo: parentCombo,
        type: "render",
        fileName: file,
        loc: { line: render.line || 0, column: render.column || 0 },
        displayName: render.tag,
      };

      // If it has children (renders that point to it as parent_render_id), make it a combo
      const hasChildren = data.renders.some(
        (r) => r.parent_render_id === render.id,
      );

      if (hasChildren) {
        combos.push({
          ...commonData,
          collapsed: true,
        });
      } else {
        nodes.push({
          ...commonData,
          radius: 10,
        });
      }

      if (render.symbol_id) {
        edges.push({
          id: `${render.id}-${render.symbol_id}`,
          source: render.id,
          target: render.symbol_id,
          label: "reference",
        });
      }
    }

    // 4. Handle Relations (Edges)
    for (const rel of relations) {
      const edgeId = `${rel.from_id}-${rel.to_id}`;
      if (edges.some((e) => e.id === edgeId)) continue;

      edges.push({
        id: edgeId,
        source: rel.from_id,
        target: rel.to_id,
        label: rel.kind,
      });
    }

    return {
      ...result,
      nodes,
      combos,
      edges,
      typeData,
    };
  },
};
