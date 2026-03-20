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

    // Build Export Map: Map<filePath, Map<exportName, symbolId>>
    const exportMap = new Map<string, Map<string | null, string>>();
    for (const exp of data.exports) {
      const scope = data.scopes.find((s) => s.id === exp.scope_id);
      if (!scope) continue;
      const filePath = fileMap.get(scope.file_id);
      if (!filePath) continue;

      if (!exportMap.has(filePath)) {
        exportMap.set(filePath, new Map());
      }
      if (exp.symbol_id) {
        exportMap
          .get(filePath)!
          .set(exp.is_default ? "default" : exp.name, exp.symbol_id);
      }
    }

    // Build Redirection Map: Map<importSymbolId, actualSymbolId>
    const redirectionMap = new Map<string, string>();
    for (const symbol of data.symbols) {
      const entity = data.entities.find((e) => e.id === symbol.entity_id);
      if (entity?.kind === "import" && entity.data_json) {
        try {
          const impData = JSON.parse(entity.data_json);
          const sourcePath = impData.source;
          const importedName =
            impData.type === "default" ? "default" : impData.importedName;

          const targetSymbolId = exportMap.get(sourcePath)?.get(importedName);
          if (targetSymbolId) {
            redirectionMap.set(symbol.id, targetSymbolId);
          }
        } catch {
          // ignore
        }
      }
    }

    // 1. Map Scopes to Combos
    for (const scope of scopes) {
      if (scope.kind === "module") continue;
      if (combos.some((c) => c.id === scope.id)) continue;

      const parentScope = data.scopes.find((s) => s.id === scope.parent_id);
      const parentComboId =
        parentScope && parentScope.kind !== "module"
          ? scope.parent_id
          : undefined;

      combos.push({
        id: scope.id,
        name: scope.kind,
        label: { text: scope.kind },
        combo: parentComboId || undefined,
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

      // Skip imports
      if (entity.kind === "import") continue;

      const scope = data.scopes.find((s) => s.id === symbol.scope_id);
      const file = scope ? fileMap.get(scope.file_id) : undefined;

      // Check if this symbol's entity has an associated scope (e.g. the body)
      const blockScope = data.scopes.find((s) => s.entity_id === entity.id);

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
          combo: scope && scope.kind !== "module" ? symbol.scope_id : undefined,
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
      const parentScope = data.scopes.find(
        (s) => s.entity_id === render.parent_entity_id,
      );

      // Always make renders children of the component scope to ensure they "stack"
      const parentCombo = parentScope?.id;

      const labelText = render.tag;

      const commonData = {
        id: render.id,
        name: render.tag,
        label: { text: labelText },
        combo: parentCombo,
        type: "render",
        fileName: file,
        loc: { line: render.line || 0, column: render.column || 0 },
        displayName: render.tag,
      };

      // Renders are now nodes that stack within the component combo
      nodes.push({
        ...commonData,
        radius: 8,
      });

      // Add edge for JSX hierarchy
      if (render.parent_render_id) {
        edges.push({
          id: `${render.parent_render_id}-${render.id}-nesting`,
          source: render.parent_render_id,
          target: render.id,
          label: "nesting",
        });
      }

      if (render.symbol_id) {
        const targetId =
          redirectionMap.get(render.symbol_id) || render.symbol_id;
        edges.push({
          id: `${render.id}-${targetId}`,
          source: render.id,
          target: targetId,
          label: "reference",
        });
      }
    }

    // 4. Handle Relations (Edges)
    for (const rel of relations) {
      const sourceId = redirectionMap.get(rel.from_id) || rel.from_id;
      const targetId = redirectionMap.get(rel.to_id) || rel.to_id;
      const edgeId = `${sourceId}-${targetId}-${rel.kind}`;
      if (edges.some((e) => e.id === edgeId)) continue;

      edges.push({
        id: edgeId,
        source: sourceId,
        target: targetId,
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
