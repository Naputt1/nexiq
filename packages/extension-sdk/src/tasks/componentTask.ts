import {
  type DatabaseData,
  type EffectInfo,
  type ReactDependency,
} from "@nexiq/shared";
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

    const scopes = batch?.scopes || data.scopes || [];
    const symbols = batch?.symbols || data.symbols || [];
    const relations = batch?.relations || data.relations || [];
    const renders = batch?.renders || data.renders || [];
    const files = data.files || [];

    const fileMap = new Map(files.map((f) => [f.id, f.path]));

    // Identify automatic JSX symbols and their entities to skip them and their scopes
    const automaticJsxEntities = new Set<string>();
    for (const symbol of symbols) {
      if (symbol.name.startsWith("jsx@")) {
        automaticJsxEntities.add(symbol.entity_id);
      }
    }

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

      // Skip scopes belonging to automatic JSX elements
      if (scope.entity_id && automaticJsxEntities.has(scope.entity_id))
        continue;

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

      // Skip automatic JSX symbols to avoid clutter
      if (symbol.name.startsWith("jsx@")) continue;

      const entity = data.entities.find((e) => e.id === symbol.entity_id);
      if (!entity) continue;

      // Skip imports
      if (entity.kind === "import") continue;

      // Skip state setters (index 1 of the state array) to avoid showing both state and setter as separate nodes
      if (entity.kind === "state" && symbol.path) {
        try {
          const pathArr = JSON.parse(symbol.path);
          if (
            Array.isArray(pathArr) &&
            pathArr.length > 0 &&
            pathArr[0] !== "0"
          ) {
            continue;
          }
        } catch {
          // ignore
        }
      }

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

          // Handle effects for this component/hook
          if (entity.data_json) {
            try {
              const metadata = JSON.parse(entity.data_json);
              if (metadata.effects) {
                for (const effect of Object.values(
                  metadata.effects as Record<string, EffectInfo>,
                )) {
                  const effectName = (effect as EffectInfo).name || "useEffect";
                  nodes.push({
                    id: effect.id,
                    name: effectName,
                    label: { text: effectName },
                    combo: blockScope.id,
                    type: "effect",
                    fileName: file,
                    loc: { line: effect.loc.line, column: effect.loc.column },
                    displayName: effectName,
                  });

                  if (effect.reactDeps) {
                    for (const dep of effect.reactDeps as ReactDependency[]) {
                      const targetId = redirectionMap.get(dep.id) || dep.id;
                      if (targetId) {
                        edges.push({
                          id: `${targetId}-${effect.id}-effect-dep`,
                          source: targetId,
                          target: effect.id,
                          label: "dependency",
                        });
                      }
                    }
                  }
                }
              }
            } catch {
              // ignore
            }
          }
        }
      } else {
        // Handle destructuring paths to group variables and reduce clutter
        let parentComboId =
          scope && scope.kind !== "module" ? symbol.scope_id : undefined;

        if (symbol.path && entity.kind !== "state") {
          try {
            const pathArr = JSON.parse(symbol.path);
            if (Array.isArray(pathArr) && pathArr.length >= 1) {
              // 1. Create a "source" combo for the entity (e.g., the hook call or variable)
              const sourceComboId = `${symbol.scope_id}:source:${symbol.entity_id}`;
              if (!combos.some((c) => c.id === sourceComboId)) {
                let sourceLabel = entity.name || entity.kind;
                if (entity.kind === "hook" && entity.data_json) {
                  try {
                    const meta = JSON.parse(entity.data_json);
                    if (meta.call?.name) sourceLabel = meta.call.name;
                  } catch {
                    // ignore
                  }
                }

                combos.push({
                  id: sourceComboId,
                  name: sourceLabel,
                  label: { text: sourceLabel },
                  combo: parentComboId,
                  type: "source-group",
                  collapsed: true,
                });
              }
              parentComboId = sourceComboId;

              // 2. Create intermediate combos for each segment of the path except the last one
              for (let i = 0; i < pathArr.length - 1; i++) {
                const segment = pathArr[i];
                // Use a stable ID for the path combo nested under the source combo
                const segmentId = `${sourceComboId}:path:${pathArr
                  .slice(0, i + 1)
                  .join("/")}`;

                if (!combos.some((c) => c.id === segmentId)) {
                  combos.push({
                    id: segmentId,
                    name: segment.toString(),
                    label: { text: segment.toString() },
                    combo: parentComboId,
                    type: "path-group",
                    collapsed: true,
                  });
                }
                parentComboId = segmentId;
              }
            }
          } catch {
            // ignore invalid path JSON
          }
        }

        const labelText = symbol.name;

        // Handle reactDeps and special labeling for hooks
        if (entity.data_json) {
          try {
            const metadata = JSON.parse(entity.data_json);

            if (metadata.reactDeps) {
              for (const dep of metadata.reactDeps as {
                id: string;
                name: string;
              }[]) {
                const targetId = redirectionMap.get(dep.id) || dep.id;
                if (targetId) {
                  edges.push({
                    id: `${targetId}-${symbol.id}-react-dep`,
                    source: targetId,
                    target: symbol.id,
                    label: "dependency",
                  });
                }
              }
            }
          } catch {
            // ignore
          }
        }

        nodes.push({
          id: symbol.id,
          name: symbol.name,
          label: { text: labelText },
          combo: parentComboId,
          type: entity.kind,
          fileName: file,
          loc: { line: entity.line || 0, column: entity.column || 0 },
          displayName: symbol.name,
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

      const parentCombo = parentScope?.id;

      // Create a "render" group combo within the parent combo if not exists
      let finalParentCombo = render.parent_render_id ?? parentCombo;
      if (parentCombo && !render.parent_render_id) {
        const renderGroupId = `render-group-${parentCombo}`;
        if (!combos.some((c) => c.id === renderGroupId)) {
          combos.push({
            id: renderGroupId,
            name: "render",
            label: { text: "render" },
            combo: parentCombo,
            type: "render-group",
            collapsed: true,
          });
        }
        finalParentCombo = renderGroupId;
      }

      const labelText = render.tag;

      const commonData = {
        id: render.id,
        name: render.tag,
        label: { text: labelText },
        combo: finalParentCombo,
        type: "render",
        fileName: file,
        loc: { line: render.line || 0, column: render.column || 0 },
        displayName: render.tag,
      };

      // Renders are now nodes that stack within the component combo
      combos.push(commonData);

      // Add edge for JSX hierarchy
      // if (render.parent_render_id) {
      //   edges.push({
      //     id: `${render.parent_render_id}-${render.id}-nesting`,
      //     source: render.parent_render_id,
      //     target: render.id,
      //     label: "nesting",
      //   });
      // }

      // if (render.symbol_id) {
      //   const targetId =
      //     redirectionMap.get(render.symbol_id) || render.symbol_id;
      //   edges.push({
      //     id: `${render.id}-${targetId}`,
      //     source: render.id,
      //     target: targetId,
      //     label: "reference",
      //   });
      // }
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
