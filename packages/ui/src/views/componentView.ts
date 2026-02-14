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
  type VariableName,
  getDisplayName,
  type ComponentFileVarHookCall,
  type ComponentFileVarCallback,
  type VariableLoc,
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
            name: { type: "identifier", name: prop.name },
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
            name: { type: "identifier", name: prop.name },
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
          else if (deleted.includes(prop.id)) propNode.gitStatus = "deleted";

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
            name: { type: "identifier", name: (obj as PropData).name },
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
        name: { type: "identifier", name: "props" },
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
          propsCombo.gitStatus = statuses[0] as "added" | "modified" | "deleted";
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
      const v = deletedObjects[deletedId];
      if (!v) return;

      // Check if it belongs to this component and isn't already there
      if (
        deletedId.startsWith(`${propIdPrefix}:`) &&
        !deletedId.startsWith(`${propIdPrefix}:prop:`) &&
        !nodes.some((n) => n.id === deletedId)
      ) {
        const loc = "loc" in v ? v.loc : undefined;
        if (!loc) return;

        let name: VariableName;
        if (v.kind === "prop" || v.kind === "spread") {
          name = { type: "identifier", name: (v as PropData).name };
        } else if (v.kind === "effect") {
          name = { type: "identifier", name: "effect" };
        } else {
          name = (v as ComponentFileVar).name;
        }

        const nodeBase: GraphNodeData = {
          id: v.id,
          name: name,
          combo: variable.id,
          fileName: `${fileName}:${loc.line}:${loc.column}`,
          pureFileName: filePath,
          loc: loc as VariableLoc,
          ui: "ui" in v ? (v as ComponentFileVar).ui : undefined,
          radius: 10,
          gitStatus: "deleted",
        };

        if ("kind" in v) {
          if (v.kind === "state") {
            const stateVar = v as ComponentFileVarState;
            nodes.push({
              ...nodeBase,
              label: { text: getDisplayName(stateVar.name) },
              type: "state",
              color: "red",
            });
          } else if (v.kind === "memo") {
            const memoVar = v as MemoFileVarHook;
            nodes.push({
              ...nodeBase,
              label: { text: getDisplayName(memoVar.name) },
              type: "memo",
              color: "red",
            });
          } else if (v.kind === "ref") {
            const refVar = v as ComponentFileVarRef;
            nodes.push({
              ...nodeBase,
              label: { text: getDisplayName(refVar.name) },
              type: "ref",
              color: "red",
            });
          } else if (v.kind === "effect") {
            nodes.push({
              ...nodeBase,
              type: "effect",
              color: "yellow",
            });
          }
        }
      }
    });

    if (variable.kind === "component") {
      combos.push({
        id: `${variable.id}-render`,
        collapsed: true,
        name: { type: "identifier", name: "render" },
        label: { text: "render" },
        combo: variable.id,
        fileName: `${fileName}:${variable.loc.line}:${variable.loc.column}`,
        pureFileName: filePath,
        ui: variable.ui?.renders?.[`${variable.id}-render`],
      });
    }

    if (variable.var) {
      for (const v of Object.values(variable.var)) {
        if (!v.loc) continue;

        const nodeBase: GraphNodeData = {
          id: v.id,
          name: v.name,
          combo: variable.id,
          fileName: `${fileName}:${v.loc.line}:${v.loc.column}`,
          pureFileName: filePath,
          loc: v.loc,
          ui: v.ui,
          radius: 10,
        };

        if (added.includes(v.id)) nodeBase.gitStatus = "added";
        else if (modified.includes(v.id)) nodeBase.gitStatus = "modified";
        else if (deleted.includes(v.id)) nodeBase.gitStatus = "deleted";

        if (v.kind == "state") {
          nodes.push({
            ...nodeBase,
            label: {
              text: getDisplayName(v.name),
            },
            type: "state",
            color: "red",
          });
        } else if (v.kind == "hook" && v.type !== "function") {
          const hookCall = v as ComponentFileVarHookCall;
          nodes.push({
            ...nodeBase,
            label: {
              text: getDisplayName(hookCall.name),
            },
            type: "hook",
            color: "red",
          });

          if (hookCall.dependencies) {
            for (const dep of Object.values(hookCall.dependencies)) {
              hookCallMap.set(`${variable.id}:${dep.name}`, hookCall.id);
            }
          }
        } else if (v.kind == "memo" || v.kind == "callback") {
          const withCallback = v as MemoFileVarHook | ComponentFileVarCallback;
          nodes.push({
            ...nodeBase,
            label: {
              text: getDisplayName(withCallback.name),
            },
            type: v.kind,
            color: "red",
          });

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
          nodes.push({
            ...nodeBase,
            label: {
              text: getDisplayName(refVar.name),
            },
            type: "ref",
            color: "red",
          });

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
        }
      }
    }

    if (variable.effects) {
      for (const effect of Object.values(variable.effects)) {
        const effectNode: GraphNodeData = {
          id: effect.id,
          name: { type: "identifier", name: "effect" },
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

    if (variable.kind === "component" && variable.renders) {
      for (const render of Object.values(variable.renders)) {
        for (const file of Object.values(graphData.files)) {
          if (Object.prototype.hasOwnProperty.call(file.var, render.id)) {
            const v = file.var[render.id];
            const renderNode: GraphNodeData = {
              id: `${variable.id}-render-${render.id}`,
              name: v.name,
              label: {
                text: getDisplayName(v.name),
              },
              combo: `${variable.id}-render`,
              radius: 10,
              fileName: `${fileName}:${render.loc.line}:${render.loc.column}`,
              pureFileName: file.path,
              loc: render.loc,
              ui: variable.ui?.renders?.[render.id],
            };

            // For render nodes, check if the component being rendered was changed
            if (added.includes(v.id)) renderNode.gitStatus = "added";
            else if (modified.includes(v.id)) renderNode.gitStatus = "modified";
            else if (deleted.includes(v.id)) renderNode.gitStatus = "deleted";

            nodes.push(renderNode);

            edges.push({
              id: `${variable.id}-render-${render.id}-${v.id}`,
              source: `${variable.id}-render-${render.id}`,
              target: v.id,
            });
            break;
          }
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
            variable.var,
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
        const parentId = parts.length > 1 ? parts[0] : undefined;

        // If it's a prop, it should go into the 'props' combo of its parent
        const comboId =
          (obj.kind === "prop" || obj.kind === "spread") && parentId
            ? `${parentId}-props`
            : parentId;

        const filePath = (obj as { file?: string }).file || "";
        const loc = "loc" in obj ? obj.loc : undefined;

        let name: VariableName;
        if (obj.kind === "prop" || obj.kind === "spread") {
          name = { type: "identifier", name: (obj as PropData).name };
        } else if (obj.kind === "effect") {
          name = { type: "identifier", name: "effect" };
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
          nodes.push({
            ...nodeBase,
            label: { text: getDisplayName(state.name) },
            type: "state",
            color: "red",
          });
        } else if (obj.kind === "memo") {
          const memo = obj as MemoFileVarHook;
          nodes.push({
            ...nodeBase,
            label: { text: getDisplayName(memo.name) },
            type: "memo",
            color: "red",
          });
        } else if (obj.kind === "ref") {
          const ref = obj as ComponentFileVarRef;
          nodes.push({
            ...nodeBase,
            label: { text: getDisplayName(ref.name) },
            type: "ref",
            color: "red",
          });
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
