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
} from "@nexiq/extension-sdk";

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
        category: edge.category || edge.edgeKind || edge.name || "dependency",
        edgeKind: edge.edgeKind || edge.name || "dependency",
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
          combo.displayName = symbol.name;
          combo.type = entity.kind;
          combo.name = symbol.name;

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
                          name: "dependency",
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
            name: "render",
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
              combo: render.id,
              type: "props-group",
              collapsed: true,
            });

            for (const prop of props) {
              const propId = `${render.id}:prop:${prop.name}`;
              nodes.push({
                id: propId,
                name: prop.name,
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
                  name: "value",
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
        name: rel.kind,
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
        name: usageEdge.edgeKind,
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
  runSqlite: (context: TaskContext): void => {
    const db = context.db;
    if (!db) return;

    const packages = db.prepare("SELECT * FROM packages").all() as any[];
    const files = db.prepare("SELECT * FROM files").all() as any[];
    const scopes = db.prepare("SELECT * FROM scopes").all() as any[];
    const entities = db.prepare("SELECT * FROM entities").all() as any[];
    const symbols = db.prepare("SELECT * FROM symbols").all() as any[];
    const relations = db.prepare("SELECT * FROM relations").all() as any[];
    const renders = db.prepare("SELECT * FROM renders").all() as any[];
    const exports = db.prepare("SELECT * FROM exports").all() as any[];

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

    const insertNode = db.prepare(`
      INSERT INTO out_nodes (id, name, type, combo_id, color, radius, display_name, meta_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertEdge = db.prepare(`
      INSERT INTO out_edges (id, source, target, name, kind, category, meta_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertCombo = db.prepare(`
      INSERT INTO out_combos (id, name, type, parent_id, color, radius, collapsed, display_name, meta_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertDetail = db.prepare(`
      INSERT INTO out_details (id, file_name, project_path, line, "column", data_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const addedEdges = new Set<string>();
    const addEdge = (edge: any) => {
      const id = edge.id;
      if (addedEdges.has(id)) return;
      addedEdges.add(id);
      insertEdge.run(
        id,
        edge.source,
        edge.target,
        edge.name || "dependency",
        edge.edgeKind || edge.name || "dependency",
        edge.category || edge.edgeKind || edge.name || "dependency",
        edge.usages ? JSON.stringify(edge.usages) : null,
      );
    };

    const addedCombos = new Set<string>();
    const ensurePackageCombo = (packageId: string) => {
      if (!usePackageCombos) return undefined;
      const comboId = `package:${packageId}`;
      if (!addedCombos.has(comboId)) {
        const pkg = packages.find((p) => p.id === packageId);
        insertCombo.run(
          comboId,
          pkg?.name || packageId,
          "package",
          null,
          null,
          24,
          1,
          pkg?.name || packageId,
          null,
        );
        addedCombos.add(comboId);
      }
      return comboId;
    };

    // Identify automatic JSX symbols
    const automaticJsxEntities = new Set<string>();
    for (const symbol of symbols) {
      if (symbol.name.startsWith("jsx@")) {
        automaticJsxEntities.add(symbol.entity_id);
      }
    }

    // Build Export Map
    const exportMap = new Map<string, Map<string | null, string>>();
    for (const exp of exports) {
      const scope = scopes.find((s) => s.id === exp.scope_id);
      if (!scope) continue;
      const fileInfo = fileInfoMap.get(scope.file_id);
      if (!fileInfo) continue;
      if (!exportMap.has(fileInfo.path)) {
        exportMap.set(fileInfo.path, new Map());
      }
      if (exp.symbol_id) {
        exportMap
          .get(fileInfo.path)!
          .set(exp.is_default ? "default" : exp.name, exp.symbol_id);
      }
    }

    // Build Redirection Map
    const redirectionMap = new Map<string, string>();
    for (const symbol of symbols) {
      const entity = entities.find((e) => e.id === symbol.entity_id);
      if (entity?.kind === "import" && entity.data_json) {
        try {
          const impData = JSON.parse(entity.data_json);
          const targetSymbolId = exportMap
            .get(impData.source)
            ?.get(
              impData.type === "default" ? "default" : impData.importedName,
            );
          if (targetSymbolId) redirectionMap.set(symbol.id, targetSymbolId);
        } catch {}
      }
    }

    // 1. Scopes
    for (const scope of scopes) {
      if (scope.kind === "module") continue;
      if (addedCombos.has(scope.id)) continue;
      if (scope.entity_id && automaticJsxEntities.has(scope.entity_id))
        continue;

      const parentScope = scopes.find((s) => s.id === scope.parent_id);
      let parentComboId =
        parentScope && parentScope.kind !== "module"
          ? scope.parent_id
          : undefined;
      if (!parentComboId) {
        const fileInfo = fileInfoMap.get(scope.file_id);
        if (fileInfo?.packageId)
          parentComboId = ensurePackageCombo(fileInfo.packageId);
      }

      insertCombo.run(
        scope.id,
        scope.kind,
        "scope",
        parentComboId || null,
        null,
        18,
        1,
        null,
        null,
      );
      addedCombos.add(scope.id);
    }

    // 2. Symbols
    const addedNodes = new Set<string>();
    for (const symbol of symbols) {
      if (addedNodes.has(symbol.id) || addedCombos.has(symbol.id)) continue;
      if (symbol.name.startsWith("jsx@")) continue;

      const entity = entities.find((e) => e.id === symbol.entity_id);
      if (!entity || entity.kind === "import") continue;

      // Skip state setters
      if (entity.kind === "state" && symbol.path) {
        try {
          const pathArr = JSON.parse(symbol.path);
          if (
            Array.isArray(pathArr) &&
            pathArr.length > 0 &&
            pathArr[0] !== "0"
          )
            continue;
        } catch {}
      }

      const scope = scopes.find((s) => s.id === symbol.scope_id);
      const fileInfo = scope ? fileInfoMap.get(scope.file_id) : undefined;
      const file = fileInfo?.path;
      const projectPath = fileInfo?.projectPath;
      const blockScope = scopes.find((s) => s.entity_id === entity.id);

      if (blockScope) {
        db.prepare(
          "UPDATE out_combos SET display_name = ?, type = ?, name = ? WHERE id = ?",
        ).run(symbol.name, entity.kind, symbol.name, blockScope.id);
        insertDetail.run(
          blockScope.id,
          file,
          projectPath,
          entity.line || 0,
          entity.column || 0,
          entity.data_json,
        );

        // Metadata handling (effects, props, refs)
        if (entity.data_json) {
          try {
            const meta = JSON.parse(entity.data_json);
            if (meta.effects) {
              for (const effect of Object.values(meta.effects as any)) {
                const eff: any = effect;
                const name = eff.name || "useEffect";
                insertNode.run(
                  eff.id,
                  name,
                  "effect",
                  blockScope.id,
                  null,
                  14,
                  name,
                  null,
                );
                insertDetail.run(
                  eff.id,
                  file,
                  projectPath,
                  eff.loc.line,
                  eff.loc.column,
                  null,
                );
                if (eff.reactDeps) {
                  for (const dep of eff.reactDeps) {
                    const targetId = redirectionMap.get(dep.id) || dep.id;
                    addEdge({
                      id: `${targetId}-${eff.id}-effect-dep`,
                      source: targetId,
                      target: eff.id,
                      name: "dependency",
                    });
                  }
                }
              }
            }
            if (meta.props?.length > 0) {
              const pcId = `${blockScope.id}:props-group`;
              insertCombo.run(
                pcId,
                "Props",
                "props-group",
                blockScope.id,
                null,
                18,
                1,
                "Props",
                null,
              );
              insertDetail.run(pcId, file, projectPath, 0, 0, null);
              addedCombos.add(pcId);
              for (const prop of meta.props) {
                insertNode.run(
                  prop.id,
                  prop.name,
                  "prop",
                  pcId,
                  null,
                  12,
                  prop.name,
                  null,
                );
                insertDetail.run(
                  prop.id,
                  file,
                  projectPath,
                  prop.loc?.line || 0,
                  prop.loc?.column || 0,
                  null,
                );
              }
            }
          } catch {}
        }
      } else {
        let pcId =
          scope && scope.kind !== "module" ? symbol.scope_id : undefined;
        if (!pcId && fileInfo?.packageId)
          pcId = ensurePackageCombo(fileInfo.packageId);

        insertNode.run(
          symbol.id,
          symbol.name,
          entity.kind,
          pcId || null,
          null,
          20,
          symbol.name,
          entity.data_json,
        );
        insertDetail.run(
          symbol.id,
          file,
          projectPath,
          entity.line || 0,
          entity.column || 0,
          entity.data_json,
        );
        addedNodes.add(symbol.id);
      }
    }

    // 3. Renders
    for (const render of renders) {
      if (addedNodes.has(render.id) || addedCombos.has(render.id)) continue;
      const fileInfo = fileInfoMap.get(render.file_id);
      const parentScope = scopes.find(
        (s) => s.entity_id === render.parent_entity_id,
      );
      let pcId = render.parent_render_id ?? parentScope?.id;
      if (!pcId && fileInfo?.packageId)
        pcId = ensurePackageCombo(fileInfo.packageId);

      if (parentScope?.id && !render.parent_render_id) {
        const rgId = `render-group-${parentScope.id}`;
        if (!addedCombos.has(rgId)) {
          insertCombo.run(
            rgId,
            "render",
            "render-group",
            parentScope.id,
            null,
            18,
            1,
            "render",
            null,
          );
          addedCombos.add(rgId);
        }
        pcId = rgId;
      }

      insertCombo.run(
        render.id,
        render.tag,
        "render",
        pcId || null,
        null,
        14,
        1,
        render.tag,
        null,
      );
      insertDetail.run(
        render.id,
        fileInfo?.path,
        fileInfo?.projectPath,
        render.line || 0,
        render.column || 0,
        render.data_json,
      );
      addedCombos.add(render.id);

      if (render.data_json) {
        try {
          const props = JSON.parse(render.data_json);
          if (props?.length > 0) {
            const rpgId = `${render.id}:props-group`;
            insertCombo.run(
              rpgId,
              "Props",
              "props-group",
              render.id,
              null,
              16,
              1,
              "Props",
              null,
            );
            addedCombos.add(rpgId);
            for (const prop of props) {
              const pId = `${render.id}:prop:${prop.name}`;
              insertNode.run(
                pId,
                prop.name,
                "prop",
                rpgId,
                null,
                12,
                prop.name,
                null,
              );
              insertDetail.run(
                pId,
                fileInfo?.path,
                fileInfo?.projectPath,
                render.line || 0,
                render.column || 0,
                null,
              );
              if (prop.valueId) {
                const tId = redirectionMap.get(prop.valueId) || prop.valueId;
                addEdge({
                  id: `${tId}-${pId}-prop-value`,
                  source: tId,
                  target: pId,
                  name: "value",
                });
              }
            }
          }
        } catch {}
      }
    }

    // 4. Relations
    for (const rel of relations) {
      if (rel.kind === "parent-child") continue;
      const sId = redirectionMap.get(rel.from_id) || rel.from_id;
      const tId = redirectionMap.get(rel.to_id) || rel.to_id;
      if (rel.kind.startsWith("usage-")) {
        const uid = `${sId}-${tId}-${rel.kind}`;
        const usage = rel.data_json ? JSON.parse(rel.data_json) : undefined;
        let entry = usageEdgeMap.get(uid);
        if (!entry) {
          entry = {
            id: uid,
            source: sId,
            target: tId,
            edgeKind: rel.kind,
            category: rel.kind,
            usages: [],
          };
          usageEdgeMap.set(uid, entry);
        }
        if (usage) entry.usages.push(usage);
        continue;
      }
      addEdge({
        id: `${sId}-${tId}-${rel.kind}`,
        source: sId,
        target: tId,
        name: rel.kind,
        edgeKind: rel.kind,
        category: rel.kind,
      });
    }

    for (const use of usageEdgeMap.values()) {
      addEdge(use);
    }
  },
};
