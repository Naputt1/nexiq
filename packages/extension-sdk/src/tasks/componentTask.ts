import {
  ComponentInfoRenderDependency,
  type EffectInfo,
  type ReactDependency,
  type UsageOccurrence,
} from "@nexiq/shared";
import {
  type GraphComboData,
  type GraphArrowData,
  type GraphNodeData,
  type GraphNodeDetail,
  type GraphViewResult,
  type GraphViewTask,
  type TaskContext,
  getTaskData,
} from "../index.js";

export const componentTask: GraphViewTask = {
  id: "component-structure",
  priority: 10,
  run: (result: GraphViewResult, context: TaskContext): GraphViewResult => {
    const data = getTaskData(context);
    const combos: GraphComboData[] = [...result.combos];
    const nodes: GraphNodeData[] = [...result.nodes];
    const details: Record<string, GraphNodeDetail> = { ...result.details };
    const edges: GraphArrowData[] = [...result.edges];
    const typeData = { ...result.typeData };

    const scopes = data.scopes || [];
    const symbols = data.symbols || [];
    const relations = data.relations || [];
    const renders = data.renders || [];
    const files = data.files || [];
    const packages = data.packages || [];

    const packagePathMap = new Map(packages.map((p) => [p.id, p.path]));
    const fileInfoMap = new Map(
      files.map((f) => [
        f.id,
        {
          path: f.path,
          packageId: f.package_id,
          projectPath: f.package_id
            ? packagePathMap.get(f.package_id)
            : undefined,
        },
      ]),
    );

    const usePackageCombos = packages.length > 1;
    const usageEdgeMap = new Map<
      string,
      {
        id: string;
        source: string;
        target: string;
        edgeKind: string;
        category: string;
        usages: UsageOccurrence[];
      }
    >();

    const addEdge = (edge: GraphArrowData) => {
      edges.push({
        category: edge.category || edge.edgeKind || edge.label || "dependency",
        edgeKind: edge.edgeKind || edge.label || "dependency",
        ...edge,
      });
    };

    const ensurePackageCombo = (packageId: string) => {
      if (!usePackageCombos) return undefined;
      const comboId = `package:${packageId}`;
      if (!combos.some((c) => c.id === comboId)) {
        const pkg = packages.find((p) => p.id === packageId);
        combos.push({
          id: comboId,
          name: pkg?.name || packageId,
          label: { text: pkg?.name || packageId },
          type: "package",
          collapsed: true,
        });
      }
      return comboId;
    };

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
      const fileInfo = fileInfoMap.get(scope.file_id);
      if (!fileInfo) continue;
      const filePath = fileInfo.path;

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
      let parentComboId =
        parentScope && parentScope.kind !== "module"
          ? scope.parent_id
          : undefined;

      if (!parentComboId) {
        const fileInfo = fileInfoMap.get(scope.file_id);
        if (fileInfo?.packageId) {
          parentComboId = ensurePackageCombo(fileInfo.packageId);
        }
      }

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
      const fileInfo = scope ? fileInfoMap.get(scope.file_id) : undefined;
      const file = fileInfo?.path;
      const projectPath = fileInfo?.projectPath;

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

          details[combo.id] = {
            id: combo.id,
            fileName: file,
            projectPath: projectPath,
            loc: { line: entity.line || 0, column: entity.column || 0 },
            componentType: entity.type,
          };

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
                    displayName: effectName,
                  });

                  details[effect.id] = {
                    id: effect.id,
                    fileName: file,
                    projectPath: projectPath,
                    loc: { line: effect.loc.line, column: effect.loc.column },
                  };

                  if (effect.reactDeps) {
                    for (const dep of effect.reactDeps as ReactDependency[]) {
                      const targetId = redirectionMap.get(dep.id) || dep.id;
                      if (targetId) {
                        addEdge({
                          id: `${targetId}-${effect.id}-effect-dep`,
                          source: targetId,
                          target: effect.id,
                          label: "dependency",
                          edgeKind: "dependency",
                          category: "dependency",
                        });
                      }
                    }
                  }
                }
              }
              if (
                metadata.props &&
                Array.isArray(metadata.props) &&
                metadata.props.length > 0
              ) {
                const propsComboId = `${blockScope.id}:props-group`;
                combos.push({
                  id: propsComboId,
                  name: "Props",
                  label: { text: "Props" },
                  combo: blockScope.id,
                  type: "props-group",
                  collapsed: true,
                  displayName: "Props",
                });

                details[propsComboId] = {
                  id: propsComboId,
                  fileName: file,
                  projectPath: projectPath,
                };

                for (const prop of metadata.props) {
                  nodes.push({
                    id: prop.id,
                    name: prop.name,
                    label: { text: prop.name },
                    combo: propsComboId,
                    type: "prop",
                    displayName: prop.name,
                  });

                  details[prop.id] = {
                    id: prop.id,
                    fileName: file,
                    projectPath: projectPath,
                    loc: prop.loc
                      ? { line: prop.loc.line, column: prop.loc.column }
                      : undefined,
                  };
                }
              }

              if (
                metadata.refs &&
                Array.isArray(metadata.refs) &&
                metadata.refs.length > 0
              ) {
                const refsComboId = `${blockScope.id}:refs-group`;
                combos.push({
                  id: refsComboId,
                  name: "Refs",
                  label: { text: "Refs" },
                  combo: blockScope.id,
                  type: "refs-group",
                  collapsed: true,
                  displayName: "Refs",
                });

                details[refsComboId] = {
                  id: refsComboId,
                  fileName: file,
                  projectPath: projectPath,
                };
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

        if (!parentComboId) {
          if (fileInfo?.packageId) {
            parentComboId = ensurePackageCombo(fileInfo.packageId);
          }
        }

        // Check if this symbol is a ref belonging to a component
        if (entity.kind === "ref") {
          const componentScope = data.scopes.find(
            (s) => s.id === symbol.scope_id,
          );
          if (componentScope) {
            const refsComboId = `${componentScope.id}:refs-group`;
            if (combos.some((c) => c.id === refsComboId)) {
              parentComboId = refsComboId;
            }
          }
        }

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
                  addEdge({
                    id: `${targetId}-${symbol.id}-react-dep`,
                    source: targetId,
                    target: symbol.id,
                    label: "dependency",
                    edgeKind: "dependency",
                    category: "dependency",
                  });
                }
              }
            }
          } catch {
            // ignore
          }
        }

        const componentData = entity.data_json
          ? JSON.parse(entity.data_json)
          : {};
        nodes.push({
          id: symbol.id,
          name: symbol.name,
          label: { text: labelText },
          combo: parentComboId,
          type: entity.kind,
          displayName: symbol.name,
          hasProps: componentData.props?.length > 0 || !!componentData.propType,
          hasHooks: componentData.hooks?.length > 0,
          hasChildren:
            componentData.children &&
            Object.keys(componentData.children).length > 0,
          pureFileName: file,
        });

        details[symbol.id] = {
          id: symbol.id,
          fileName: file,
          projectPath: projectPath,
          loc: { line: entity.line || 0, column: entity.column || 0 },
          componentType: entity.type,
          raw: entity.data_json ? JSON.parse(entity.data_json) : undefined,
        };
      }
    }

    // 3. Handle Renders (JSX)
    for (const render of renders) {
      if (
        nodes.some((n) => n.id === render.id) ||
        combos.some((c) => c.id === render.id)
      )
        continue;

      const fileInfo = fileInfoMap.get(render.file_id);
      const file = fileInfo?.path;
      const projectPath = fileInfo?.projectPath;
      const parentScope = data.scopes.find(
        (s) => s.entity_id === render.parent_entity_id,
      );

      const parentCombo = parentScope?.id;

      // Create a "render" group combo within the parent combo if not exists
      let finalParentCombo = render.parent_render_id ?? parentCombo;

      if (!finalParentCombo) {
        if (fileInfo?.packageId) {
          finalParentCombo = ensurePackageCombo(fileInfo.packageId);
        }
      }

      if (parentCombo && !render.parent_render_id) {
        const renderGroupId = `render-group-${parentCombo}`;
        if (!combos.some((c) => c.id === renderGroupId)) {
          combos.push({
            id: renderGroupId,
            name: "JSX",
            label: { text: "JSX" },
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
        displayName: render.tag,
      };

      details[render.id] = {
        id: render.id,
        fileName: file,
        projectPath: projectPath,
        loc: { line: render.line || 0, column: render.column || 0 },
      };

      // Renders are now nodes that stack within the component combo
      combos.push(commonData);

      // Handle Props for renders
      if (render.data_json) {
        try {
          const props = JSON.parse(
            render.data_json,
          ) as ComponentInfoRenderDependency[];
          if (props && props.length > 0) {
            const propsGroupId = `${render.id}:props-group`;
            combos.push({
              id: propsGroupId,
              name: "Props",
              label: { text: "Props" },
              combo: render.id,
              type: "props-group",
              collapsed: true,
            });

            for (const prop of props) {
              const propId = `${render.id}:prop:${prop.name}`;
              nodes.push({
                id: propId,
                name: prop.name,
                label: { text: prop.name },
                combo: propsGroupId,
                type: "prop",
                displayName: prop.name,
              });

              details[propId] = {
                id: propId,
                fileName: file,
                projectPath: projectPath,
                loc: { line: render.line || 0, column: render.column || 0 },
              };

              if (prop.valueId) {
                const targetId =
                  redirectionMap.get(prop.valueId) || prop.valueId;
                addEdge({
                  id: `${targetId}-${propId}-prop-value`,
                  source: targetId,
                  target: propId,
                  label: "value",
                  edgeKind: "dependency",
                  category: "dependency",
                });
              }
            }
          }
        } catch {
          // ignore
        }
      }

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
      if (rel.kind === "parent-child") continue;
      const sourceId = redirectionMap.get(rel.from_id) || rel.from_id;
      const targetId = redirectionMap.get(rel.to_id) || rel.to_id;
      const isUsageRelation = rel.kind.startsWith("usage-");
      if (isUsageRelation) {
        const edgeId = `${sourceId}-${targetId}-${rel.kind}`;
        const key = edgeId;
        const usage = rel.data_json
          ? (JSON.parse(rel.data_json) as UsageOccurrence)
          : undefined;

        const entry = usageEdgeMap.get(key) || {
          id: edgeId,
          source: sourceId,
          target: targetId,
          edgeKind: rel.kind,
          category: rel.kind,
          usages: [],
        };

        if (usage) {
          entry.usages.push(usage);
        }

        usageEdgeMap.set(key, entry);
        continue;
      }

      const edgeId = `${sourceId}-${targetId}-${rel.kind}`;
      if (edges.some((e) => e.id === edgeId)) continue;

      addEdge({
        id: edgeId,
        source: sourceId,
        target: targetId,
        label: rel.kind,
        edgeKind: rel.kind,
        category:
          rel.kind === "render" || rel.kind === "dependency"
            ? rel.kind
            : rel.kind,
      });
    }

    for (const usageEdge of usageEdgeMap.values()) {
      addEdge({
        id: usageEdge.id,
        source: usageEdge.source,
        target: usageEdge.target,
        label: usageEdge.edgeKind,
        edgeKind: usageEdge.edgeKind,
        category: usageEdge.category,
        usages: usageEdge.usages,
        usageCount: usageEdge.usages.length,
        opensTo:
          usageEdge.usages[0] != null
            ? {
                fileName: usageEdge.usages[0].filePath,
                line: usageEdge.usages[0].line,
                column: usageEdge.usages[0].column,
              }
            : undefined,
      });
    }

    return {
      ...result,
      nodes,
      combos,
      edges,
      details: { ...result.details, ...details },
      typeData,
    };
  },
};
