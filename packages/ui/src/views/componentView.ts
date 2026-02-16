import {
  type ComponentFileVar,
  type PropData,
  type PropDataType,
  type TypeDataDeclare,
  type JsonData,
  type ComponentFileVarState,
  type MemoFileVarHook,
  type ComponentFileVarRef,
  type ComponentFileVarComponent,
  type ComponentFileVarJSX,
  type VariableName,
  getDisplayName,
  type ComponentFileVarCallback,
  type VariableLoc,
  type ReactVarKind,
  type ComponentInfoRender,
} from "shared";
import {
  type GraphComboData,
  type GraphArrowData,
  type GraphNodeData,
} from "../graph/hook";
import { type GraphViewResult } from "./types";

export const generateComponentGraphData = (
  graphData: JsonData,
): GraphViewResult => {
  const {
    added = [],
    modified = [],
    deleted = [],
    deletedObjects = {},
  } = graphData.diff || {};

  const combos: GraphComboData[] = [];
  const nodes: GraphNodeData[] = [];
  const edges: GraphArrowData[] = [];

  const hookCallMap = new Map<string, string>(); // ParentID:TargetHookName -> CallNodeID
  const hookComboNameMap = new Map<string, string>(); // HookID -> HookName

  const isPropNode = (props: PropData[], id: string): boolean => {
    for (const p of props) {
      if (p.id === id) return true;
      if (p.props && isPropNode(p.props, id)) return true;
    }
    return false;
  };

  const findVariableById = (idOrName: string): ComponentFileVar | undefined => {
    for (const file of Object.values(graphData.files)) {
      if (file.var[idOrName]) return file.var[idOrName];
      // Search in nested variables
      const searchNested = (
        vars: Record<string, ComponentFileVar>,
      ): ComponentFileVar | undefined => {
        for (const v of Object.values(vars)) {
          if (
            v.id === idOrName ||
            v.name.id === idOrName ||
            getDisplayName(v.name) === idOrName
          )
            return v;
          if ("var" in v && v.var) {
            const found = searchNested(
              v.var as Record<string, ComponentFileVar>,
            );
            if (found) return found;
          }
        }
        return undefined;
      };
      const found = searchNested(file.var);
      if (found) return found;
    }
    return undefined;
  };

  const isAnonymousJSX = (name: VariableName | string): boolean => {
    const n =
      typeof name === "string"
        ? name
        : name.type === "identifier"
          ? name.name
          : "";
    return n.startsWith("jsx@");
  };

  const addRenderNodes = (
    renders: Record<string, ComponentInfoRender>,
    ownerId: string,
    parentComboId: string,
    filePath: string,
    fileNamePrefix: string,
  ) => {
    for (const render of Object.values(renders)) {
      const v = findVariableById(render.id);
      const renderNodeId = `${ownerId}-render-${render.instanceId}`;
      const vIsJSXWithRenders =
        v?.type === "jsx" && v.renders && Object.keys(v.renders).length > 0;
      const hasChildren =
        (render.renders && Object.keys(render.renders).length > 0) ||
        vIsJSXWithRenders;

      const commonData = {
        id: renderNodeId,
        name: v
          ? v.name
          : {
              type: "identifier" as const,
              name: render.tag,
              id: render.id,
              loc: render.loc,
            },
        label: {
          text:
            v && !isAnonymousJSX(v.name) ? getDisplayName(v.name) : render.tag,
        },
        combo: render.parentId
          ? `${ownerId}-render-${render.parentId}`
          : parentComboId,
        fileName: `${fileNamePrefix}:${render.loc.line}:${render.loc.column}`,
        pureFileName: filePath,
        loc: render.loc,
        ui: graphData.files[filePath]?.var[ownerId]?.ui?.renders?.[
          render.instanceId
        ],
        type: "render" as const,
      };

      if (hasChildren) {
        const renderCombo: GraphComboData = {
          ...commonData,
          collapsed: true,
        };
        if (v && added.includes(v.id)) renderCombo.gitStatus = "added";
        else if (v && modified.includes(v.id))
          renderCombo.gitStatus = "modified";
        else if (v && deleted.includes(v.id)) renderCombo.gitStatus = "deleted";
        combos.push(renderCombo);
      } else {
        const renderNode: GraphNodeData = {
          ...commonData,
          radius: 10,
        };
        if (v && added.includes(v.id)) renderNode.gitStatus = "added";
        else if (v && modified.includes(v.id))
          renderNode.gitStatus = "modified";
        else if (v && deleted.includes(v.id)) renderNode.gitStatus = "deleted";
        nodes.push(renderNode);
      }

      if (v) {
        edges.push({
          id: `${renderNodeId}-${v.id}`,
          source: renderNodeId,
          target: v.id,
        });
      }

      if (render.renders && Object.keys(render.renders).length > 0) {
        addRenderNodes(
          render.renders,
          ownerId,
          hasChildren ? renderNodeId : parentComboId,
          filePath,
          fileNamePrefix,
        );
      }

      if (vIsJSXWithRenders && v && v.type === "jsx") {
        addRenderNodes(
          v.renders,
          ownerId,
          renderNodeId,
          filePath,
          fileNamePrefix,
        );
      }
    }
  };

  const addCombo = (
    variable: ComponentFileVar,
    filePath: string,
    parentID?: string,
  ) => {
    if (variable.kind !== "component" && variable.kind !== "hook") return;
    if (variable.type !== "function") return; // Definition must be a function

    const fileName = `${graphData.src}${filePath}`;

    const combo: GraphComboData = {
      id: variable.id,
      collapsed: true,
      name: variable.name,
      label: { text: getDisplayName(variable.name) },
      combo: parentID,
      fileName: `${fileName}:${variable.loc.line}:${variable.loc.column}`,
      pureFileName: filePath,
      scope: variable.scope,
      props: variable.props,
      propType: variable.propType,
      type: variable.kind,
      ui: variable.ui,
      hooks: variable.hooks,
      collapsedRadius: variable.kind === "hook" && parentID ? 10 : undefined,
      renders: variable.kind === "component" ? variable.renders : undefined,
    };

    if (added.includes(variable.id)) combo.gitStatus = "added";
    else if (modified.includes(variable.id)) combo.gitStatus = "modified";
    else if (deleted.includes(variable.id)) combo.gitStatus = "deleted";

    combos.push(combo);

    const propsComboId = `${variable.id}-props`;
    const propNodes: GraphNodeData[] = [];
    const propCombos: GraphComboData[] = [];

    const addProps = (props: PropData[], parentComboId: string) => {
      for (const prop of props) {
        if (added.includes(prop.id)) prop.gitStatus = "added";
        else if (modified.includes(prop.id)) prop.gitStatus = "modified";
        else if (deleted.includes(prop.id)) prop.gitStatus = "deleted";

        if (prop.props && prop.props.length > 0) {
          const subPropsComboId = `${prop.id}-subprops`;
          const subPropsCombo: GraphComboData = {
            id: subPropsComboId,
            collapsed: true,
            name: {
              type: "identifier",
              name: prop.name,
              id: prop.id,
              loc: prop.loc || variable.loc,
            },
            label: { text: prop.name },
            color: "green",
            combo: parentComboId,
            fileName: `${fileName}:${variable.loc.line}:${variable.loc.column}`,
            pureFileName: filePath,
            ui: variable.ui?.renders?.[subPropsComboId],
          };

          if (added.includes(prop.id)) subPropsCombo.gitStatus = "added";
          else if (modified.includes(prop.id))
            subPropsCombo.gitStatus = "modified";
          else if (deleted.includes(prop.id))
            subPropsCombo.gitStatus = "deleted";

          propCombos.push(subPropsCombo);
          addProps(prop.props, subPropsComboId);
        } else {
          const propNode: GraphNodeData = {
            id: prop.id,
            name: {
              type: "identifier",
              name: prop.name,
              id: prop.id,
              loc: prop.loc || variable.loc,
            },
            label: {
              text: (prop.kind === "spread" ? "..." : "") + prop.name,
            },
            type: "prop",
            color: "green",
            radius: 10,
            combo: parentComboId,
            fileName: `${fileName}:${variable.loc.line}:${variable.loc.column}`,
            pureFileName: filePath,
          };

          if (added.includes(prop.id)) propNode.gitStatus = "added";
          else if (modified.includes(prop.id)) propNode.gitStatus = "modified";
          else if (deleted.includes(prop.id)) delete propNode.gitStatus; // Special case for prop deletion

          propNodes.push(propNode);
        }
      }
    };

    const componentProps = variable.props ? [...variable.props] : [];

    if (variable.props) {
      addProps(variable.props, propsComboId);
    }

    // Use the prefix from existing props if available,
    // otherwise try to find a deleted component with the same name in the same file to get its old ID
    let propIdPrefix = variable.id;
    if (variable.props && variable.props.length > 0) {
      propIdPrefix = variable.props[0].id.split(":prop:")[0];
    } else {
      const deletedCompId = Object.keys(deletedObjects).find((id) => {
        const obj = deletedObjects[id];
        if (!obj) return false;
        return (
          (obj.kind === "component" || obj.kind === "hook") &&
          getDisplayName((obj as ComponentFileVarComponent).name) ===
            getDisplayName(variable.name) &&
          (obj as ComponentFileVarComponent).file === filePath
        );
      });
      if (deletedCompId) propIdPrefix = deletedCompId;
    }

    // Add deleted props from parent commit
    Object.keys(deletedObjects).forEach((deletedId) => {
      const obj = deletedObjects[deletedId];
      if (!obj) return;

      // Props are identified by componentId:prop:name
      if (
        deletedId.startsWith(`${propIdPrefix}:prop:`) &&
        (obj.kind === "prop" || obj.kind === "spread")
      ) {
        // If it's not already in current props (it shouldn't be if it's in deleted)
        if (!propNodes.some((n) => n.id === deletedId)) {
          propNodes.push({
            id: deletedId,
            name: {
              type: "identifier",
              name: (obj as PropData).name,
              id: deletedId,
              loc: (obj as PropData).loc || variable.loc,
            },
            label: {
              text:
                ((obj as PropData).kind === "spread" ? "..." : "") +
                (obj as PropData).name,
            },
            type: "prop",
            color: "green",
            radius: 10,
            combo: propsComboId,

            fileName: `${fileName}:${variable.loc.line}:${variable.loc.column}`,
            pureFileName: filePath,
            gitStatus: "deleted",
          });
        }

        if (!componentProps.some((p) => p.id === deletedId)) {
          componentProps.push({
            ...(obj as PropData),
            gitStatus: "deleted",
          });
        }
      }
    });

    combo.props = componentProps;

    if (propNodes.length > 0 || propCombos.length > 0) {
      const propsCombo: GraphComboData = {
        id: propsComboId,
        collapsed: true,
        name: {
          type: "identifier",
          name: "props",
          id: propsComboId,
          loc: variable.loc,
        },
        label: { text: "props" },
        color: "green",
        combo: variable.id,
        fileName: `${fileName}:${variable.loc.line}:${variable.loc.column}`,
        pureFileName: filePath,
        ui: variable.ui?.renders?.[propsComboId],
      };

      // Calculate aggregate status for the props combo
      const allItems = [...propNodes, ...propCombos];
      const statuses = allItems
        .map((i) => i.gitStatus)
        .filter((s) => s !== undefined);

      if (statuses.length > 0) {
        const uniqueStatuses = new Set(statuses);
        // If every single prop is added, status is added.
        // If every single prop is deleted, status is deleted.
        // Otherwise, it's modified.
        if (uniqueStatuses.size === 1) {
          propsCombo.gitStatus = statuses[0] as
            | "added"
            | "modified"
            | "deleted";
        } else {
          propsCombo.gitStatus = "modified";
        }
      }

      combos.push(propsCombo);
      combos.push(...propCombos);
      nodes.push(...propNodes);
    }

    // Add deleted internal variables from deletedObjects
    Object.keys(deletedObjects).forEach((deletedId) => {
      const obj = deletedObjects[deletedId];
      if (!obj) return;

      // Check if it belongs to this component and isn't already there
      if (
        deletedId.startsWith(`${propIdPrefix}:`) &&
        !deletedId.startsWith(`${propIdPrefix}:prop:`) &&
        !nodes.some((n) => n.id === deletedId)
      ) {
        const loc = "loc" in obj ? obj.loc : undefined;
        if (!loc) return;

        let name: VariableName;
        if (obj.kind === "prop" || obj.kind === "spread") {
          name = {
            type: "identifier",
            name: (obj as PropData).name,
            loc: (obj as PropData).loc || loc,
            id: obj.id,
          };
        } else if (obj.kind === "effect") {
          name = { type: "identifier", name: "effect", loc: loc, id: obj.id };
        } else {
          name = (obj as ComponentFileVar).name;
        }

        const nodeBase: GraphNodeData = {
          id: obj.id,
          name: name,
          combo: ("parentId" in obj ? obj.parentId : undefined) || variable.id,
          fileName: `${fileName}:${loc.line}:${loc.column}`,
          pureFileName: filePath,
          loc: loc as VariableLoc,
          ui: "ui" in obj ? (obj as ComponentFileVar).ui : undefined,
          radius: 10,
          gitStatus: "deleted",
        };

        const isPattern = name.type === "object" || name.type === "array";

        if ("kind" in obj) {
          if (obj.kind === "state") {
            const stateVar = obj as ComponentFileVarState;
            if (isPattern) {
              combos.push({
                ...nodeBase,
                label: { text: getDisplayName(stateVar.name) },
                type: "state",
                color: "red",
                collapsed: true,
              });
            } else {
              nodes.push({
                ...nodeBase,
                label: { text: getDisplayName(stateVar.name) },
                type: "state",
                color: "red",
              });
            }
          } else if (obj.kind === "memo") {
            const memoVar = obj as MemoFileVarHook;
            if (isPattern) {
              combos.push({
                ...nodeBase,
                label: { text: getDisplayName(memoVar.name) },
                type: "memo",
                color: "red",
                collapsed: true,
              });
            } else {
              nodes.push({
                ...nodeBase,
                label: { text: getDisplayName(memoVar.name) },
                type: "memo",
                color: "red",
              });
            }
          } else if (obj.kind === "ref") {
            const refVar = obj as ComponentFileVarRef;
            if (isPattern) {
              combos.push({
                ...nodeBase,
                label: { text: getDisplayName(refVar.name) },
                type: "ref",
                color: "red",
                collapsed: true,
              });
            } else {
              nodes.push({
                ...nodeBase,
                label: { text: getDisplayName(refVar.name) },
                type: "ref",
                color: "red",
              });
            }
          } else if (obj.kind === "effect") {
            nodes.push({
              ...nodeBase,
              type: "effect",
              color: "yellow",
            });
          }
        }
      }
    });

    const renderComboId = `${variable.id}-render`;
    if (variable.kind === "component") {
      combos.push({
        id: renderComboId,
        collapsed: true,
        name: {
          type: "identifier",
          name: "render",
          id: renderComboId,
          loc: variable.loc,
        },
        label: { text: "render" },
        combo: variable.id,
        fileName: `${fileName}:${variable.loc.line}:${variable.loc.column}`,
        pureFileName: filePath,
        ui: variable.ui?.renders?.[renderComboId],
      });

      if (variable.renders) {
        addRenderNodes(
          variable.renders,
          variable.id,
          renderComboId,
          filePath,
          fileName,
        );
      }
    }

    if ("var" in variable && variable.var) {
      for (const v of Object.values(
        variable.var as Record<string, ComponentFileVar>,
      )) {
        if (!v.loc) continue;

        // Skip components and hooks as they are already added as combos
        if (
          v.kind === "component" ||
          (v.kind === "hook" && v.type === "function")
        ) {
          continue;
        }

        // Skip anonymous JSX elements as they are in the render tree
        if (
          v.type === "jsx" &&
          v.name.type === "identifier" &&
          v.name.name.startsWith("jsx@")
        ) {
          continue;
        }

        const nodeBase: GraphNodeData = {
          id: v.id,
          name: v.name,
          combo: v.parentId || variable.id,
          fileName: `${fileName}:${v.loc.line}:${v.loc.column}`,
          pureFileName: filePath,
          loc: v.loc,
          ui: v.ui,
          radius: 10,
          declarationKind: v.declarationKind,
        };

        if (added.includes(v.id)) nodeBase.gitStatus = "added";
        else if (modified.includes(v.id)) nodeBase.gitStatus = "modified";
        else if (deleted.includes(v.id)) nodeBase.gitStatus = "deleted";

        const isPattern = v.name.type === "object" || v.name.type === "array";

        if (v.kind == "state") {
          if (isPattern) {
            combos.push({
              ...nodeBase,
              label: { text: getDisplayName(v.name) },
              type: "state",
              color: "red",
              collapsed: true,
            });
          } else {
            nodes.push({
              ...nodeBase,
              label: {
                text: getDisplayName(v.name),
              },
              type: "state",
              color: "red",
            });
          }
        } else if (v.kind === "hook") {
          const hookCall = v;

          const addDestructiveVariable = (
            v: VariableName,
            type: ReactVarKind,
            parentName: string,
            parent?: string,
            virtualPath?: string,
          ) => {
            const currentPath = virtualPath
              ? `${virtualPath}-${parentName}`
              : parentName;

            // Use parent or hookCall.id as base to ensure uniqueness and correct nesting
            const vId = v.id || `virtual-${currentPath}`;
            const uniqueId = `${parent || hookCall.id}:${vId}`;

            if (v.type == "object" || v.type === "array") {
              const comboId = uniqueId;
              const virtualId = parent ? currentPath : undefined;
              const savedUi = virtualId
                ? hookCall.ui?.vars?.[virtualId]
                : undefined;

              const vLoc = v.loc || nodeBase.loc;
              const combo: GraphComboData = {
                ...nodeBase,
                id: comboId,
                name: v,
                label: {
                  text: parentName,
                },
                type: type,
                color: "red",
                collapsed: parent != null,
                ui: savedUi || (parent ? undefined : nodeBase.ui),
                loc: vLoc,
                fileName:
                  vLoc && vLoc.line != null
                    ? `${fileName}:${vLoc.line}:${vLoc.column}`
                    : nodeBase.fileName,
              };
              // Crucial: prevent self-parent cycles
              if (parent && parent !== comboId) {
                combo.combo = parent;
              }

              combos.push(combo);
              if (v.type === "array") {
                for (const [i, element] of v.elements.entries()) {
                  if (element != null) {
                    addDestructiveVariable(
                      element.value,
                      type,
                      "" + i,
                      comboId,
                      currentPath,
                    );
                  }
                }
              } else if (v.type === "object") {
                for (const prop of v.properties) {
                  addDestructiveVariable(
                    prop.value,
                    type,
                    prop.key,
                    comboId,
                    currentPath,
                  );
                }
              }

              return comboId;
            } else {
              const name =
                v.type === "identifier" ? v.name : `...${v.argument}`;
              const virtualId = parent ? currentPath : undefined;
              const savedUi = virtualId
                ? hookCall.ui?.vars?.[virtualId]
                : undefined;

              const vLoc = v.loc || nodeBase.loc;
              const node: GraphNodeData = {
                ...nodeBase,
                id: uniqueId,
                name: v,
                combo: parent
                  ? parent !== uniqueId
                    ? parent
                    : undefined
                  : nodeBase.combo,
                label: {
                  text: name,
                },
                type: type,
                color: "red",
                ui: savedUi || (parent ? undefined : nodeBase.ui),
                loc: vLoc,
                fileName:
                  vLoc && vLoc.line != null
                    ? `${fileName}:${vLoc.line}:${vLoc.column}`
                    : nodeBase.fileName,
              };
              nodes.push(node);

              return uniqueId;
            }
          };

          const id = addDestructiveVariable(
            hookCall.name,
            hookCall.kind,
            hookCall.call.name,
          );

          edges.push({
            id: `${id}-${hookCall.call.id}`,
            source: id,
            target: hookCall.call.id,
          });

          if (hookCall.dependencies) {
            for (const dep of Object.values(hookCall.dependencies)) {
              hookCallMap.set(`${variable.id}:${dep.name}`, hookCall.id);
            }
          }
        } else if (v.kind == "memo" || v.kind == "callback") {
          const withCallback = v as MemoFileVarHook | ComponentFileVarCallback;
          if (isPattern) {
            combos.push({
              ...nodeBase,
              label: { text: getDisplayName(withCallback.name) },
              type: v.kind,
              color: "red",
              collapsed: true,
            });
          } else {
            nodes.push({
              ...nodeBase,
              label: {
                text: getDisplayName(withCallback.name),
              },
              type: v.kind,
              color: "red",
            });
          }

          for (const dep of withCallback.reactDeps) {
            const isProp = isPropNode(variable.props || [], dep.id);
            edges.push({
              id: `${dep.id}-${withCallback.id}`,
              source: dep.id,
              target: withCallback.id,
              combo: isProp ? undefined : variable.id,
            });
          }
        } else if (v.kind == "ref") {
          const refVar = v as ComponentFileVarRef;
          if (isPattern) {
            combos.push({
              ...nodeBase,
              label: { text: getDisplayName(refVar.name) },
              type: "ref",
              color: "red",
              collapsed: true,
            });
          } else {
            nodes.push({
              ...nodeBase,
              label: {
                text: getDisplayName(refVar.name),
              },
              type: "ref",
              color: "red",
            });
          }

          const addRefDefaultDependency = (defaultData: PropDataType) => {
            if (defaultData.type === "ref") {
              const id =
                defaultData.refType === "named"
                  ? defaultData.name
                  : defaultData.names[0];

              const isProp = isPropNode(variable.props || [], id);
              edges.push({
                id: `${id}-${refVar.id}`,
                source: id,
                target: refVar.id,
                combo: isProp ? undefined : variable.id,
              });
            } else if (defaultData.type === "literal-array") {
              for (const element of defaultData.elements) {
                addRefDefaultDependency(element);
              }
            } else if (defaultData.type === "literal-object") {
              for (const prop of Object.values(defaultData.properties)) {
                addRefDefaultDependency(prop);
              }
            }
          };

          addRefDefaultDependency(refVar.defaultData);
        } else {
          // Normal variables
          const labelText =
            v.type === "jsx" && isAnonymousJSX(v.name)
              ? (v as ComponentFileVarJSX).tag
              : getDisplayName(v.name);
          const commonVarData = {
            ...nodeBase,
            label: { text: labelText },
            type: (v.type === "jsx" ? "jsx" : v.kind) as GraphNodeData["type"],
            color: v.type === "jsx" ? "orange" : "blue",
            tag: v.type === "jsx" ? (v as ComponentFileVarJSX).tag : undefined,
          };

          const isJSXWithRenders =
            v.type === "jsx" && v.renders && Object.keys(v.renders).length > 0;

          if (isPattern || isJSXWithRenders) {
            const varCombo: GraphComboData = {
              ...commonVarData,
              collapsed: true,
            };
            combos.push(varCombo);

            if (v.type === "jsx" && v.renders) {
              addRenderNodes(v.renders, v.id, v.id, filePath, fileName);
            }
          } else {
            nodes.push(commonVarData);
          }

          if (v.type === "jsx") {
            const tagId = (v as ComponentFileVarJSX).tag;
            const targetV =
              findVariableById(tagId) || graphData.files[filePath]?.var[tagId];
            if (targetV) {
              edges.push({
                id: `${v.id}-${targetV.id}`,
                source: v.id,
                target: targetV.id,
              });
            }
          }
        }
      }
    }

    if (variable.effects) {
      for (const effect of Object.values(variable.effects)) {
        const effectNode: GraphNodeData = {
          id: effect.id,
          name: {
            type: "identifier",
            name: "effect",
            id: effect.id,
            loc: effect.loc,
          },
          type: "effect",
          color: "yellow",
          radius: 10,
          combo: variable.id,
          fileName: `${fileName}:${effect.loc.line}:${effect.loc.column}`,
          pureFileName: filePath,
          loc: effect.loc,
          ui: variable.ui?.renders?.[effect.id],
        };

        if (added.includes(effect.id)) effectNode.gitStatus = "added";
        else if (modified.includes(effect.id))
          effectNode.gitStatus = "modified";
        else if (deleted.includes(effect.id)) effectNode.gitStatus = "deleted";

        nodes.push(effectNode);

        for (const dep of effect.reactDeps) {
          if (dep.id == "") continue;

          const isProp = isPropNode(variable.props || [], dep.id);
          edges.push({
            id: `${dep.id}-${effect.id}`,
            source: dep.id,
            target: effect.id,
            combo: isProp ? undefined : variable.id,
          });
        }
      }
    }
  };

  const typeData: { [key: string]: TypeDataDeclare } = {};
  for (const file of Object.values(graphData.files)) {
    const addAllComponents = (
      vars: Record<string, ComponentFileVar>,
      parentID?: string,
    ) => {
      if (!vars) return;
      for (const variable of Object.values(vars)) {
        if (
          variable.kind === "component" ||
          (variable.kind === "hook" && variable.type === "function")
        ) {
          addCombo(variable, file.path, parentID);
          if (variable.kind === "hook") {
            hookComboNameMap.set(variable.id, getDisplayName(variable.name));
          }
        }
        if ("var" in variable && variable.var) {
          addAllComponents(
            variable.var as Record<string, ComponentFileVar>,
            variable.kind === "component" || variable.kind === "hook"
              ? variable.id
              : parentID,
          );
        }
      }
    };

    addAllComponents(file.var);

    if (file.tsTypes) {
      for (const typeDeclare of Object.values(file.tsTypes)) {
        typeData[typeDeclare.id] = typeDeclare;
      }
    }
  }

  // Add ALL deleted items from deletedObjects
  Object.keys(deletedObjects).forEach((deletedId) => {
    const obj = deletedObjects[deletedId];
    if (!obj) return;

    if ("kind" in obj && (obj.kind === "component" || obj.kind === "hook")) {
      // Add component or hook as combo
      if (!combos.some((c) => c.id === deletedId)) {
        const comp = obj as ComponentFileVarComponent;
        addCombo(comp, comp.file);
      }
    } else if (
      "kind" in obj &&
      (obj.kind === "prop" ||
        obj.kind === "spread" ||
        obj.kind === "state" ||
        obj.kind === "memo" ||
        obj.kind === "ref" ||
        obj.kind === "effect")
    ) {
      // If it's not already in nodes, add it
      if (!nodes.some((n) => n.id === deletedId)) {
        // Try to find the parent component ID from the ID prefix (componentId:...)
        const parts = deletedId.split(":");
        const parentIdFromParts = parts.length > 1 ? parts[0] : undefined;
        const parentId =
          ("parentId" in obj ? obj.parentId : undefined) || parentIdFromParts;

        // If it's a prop, it should go into the 'props' combo of its parent
        const comboId =
          (obj.kind === "prop" || obj.kind === "spread") && parentId
            ? `${parentId}-props`
            : parentId;

        const filePath = (obj as { file?: string }).file || "";
        const loc = "loc" in obj ? obj.loc : undefined;

        let name: VariableName;
        if (obj.kind === "prop" || obj.kind === "spread") {
          name = {
            type: "identifier",
            name: (obj as PropData).name,
            loc: (obj as PropData).loc || loc || { line: 0, column: 0 },
            id: obj.id,
          };
        } else if (obj.kind === "effect") {
          name = {
            type: "identifier",
            name: "effect",
            loc: loc || { line: 0, column: 0 },
            id: obj.id,
          };
        } else {
          name = (obj as ComponentFileVar).name;
        }
        const nodeBase: GraphNodeData = {
          id: obj.id,
          name: name,
          combo: comboId,
          fileName: loc
            ? `${graphData.src}${filePath}:${loc.line}:${loc.column}`
            : "",
          pureFileName: filePath,
          loc: loc as VariableLoc,
          ui: "ui" in obj ? (obj as ComponentFileVar).ui : undefined,
          radius: 10,
          gitStatus: "deleted",
        };

        const isPattern = name.type === "object" || name.type === "array";

        if (obj.kind === "prop" || obj.kind === "spread") {
          const prop = obj as PropData;
          nodes.push({
            ...nodeBase,
            label: {
              text: (prop.kind === "spread" ? "..." : "") + prop.name,
            },
            type: "prop",
            color: "green",
          });
        } else if (obj.kind === "state") {
          const state = obj as ComponentFileVarState;
          if (isPattern) {
            combos.push({
              ...nodeBase,
              label: { text: getDisplayName(state.name) },
              type: "state",
              color: "red",
              collapsed: true,
            });
          } else {
            nodes.push({
              ...nodeBase,
              label: { text: getDisplayName(state.name) },
              type: "state",
              color: "red",
            });
          }
        } else if (obj.kind === "memo") {
          const memo = obj as MemoFileVarHook;
          if (isPattern) {
            combos.push({
              ...nodeBase,
              label: { text: getDisplayName(memo.name) },
              type: "memo",
              color: "red",
              collapsed: true,
            });
          } else {
            nodes.push({
              ...nodeBase,
              label: { text: getDisplayName(memo.name) },
              type: "memo",
              color: "red",
            });
          }
        } else if (obj.kind === "ref") {
          const ref = obj as ComponentFileVarRef;
          if (isPattern) {
            combos.push({
              ...nodeBase,
              label: { text: getDisplayName(ref.name) },
              type: "ref",
              color: "red",
              collapsed: true,
            });
          } else {
            nodes.push({
              ...nodeBase,
              label: { text: getDisplayName(ref.name) },
              type: "ref",
              color: "red",
            });
          }
        } else if (obj.kind === "effect") {
          nodes.push({
            ...nodeBase,
            type: "effect",
            color: "yellow",
          });
        }
      }
    }
  });

  for (const e of Object.values(graphData.edges)) {
    if (e.label === "render") continue;

    let source = e.from;
    const targetName = hookComboNameMap.get(e.to);
    if (targetName) {
      const redirectedSource = hookCallMap.get(`${e.from}:${targetName}`);
      if (redirectedSource) {
        source = redirectedSource;
      }
    }

    edges.push({
      id: `${source}-${e.to}`,
      source: source,
      target: e.to,
    });
  }

  return {
    nodes,
    edges,
    combos,
    typeData,
  };
};
