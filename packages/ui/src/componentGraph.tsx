import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
} from "shared";
import useGraph, {
  type ComboData,
  type ComboGraphData,
  type EdgeData,
  type NodeData,
  type NodeGraphData,
  type useGraphProps,
} from "./graph/hook";
import { GraphRenderer } from "./graph/renderer";
import { NodeDetails } from "./components/node-details";
import { ProjectSidebar } from "./components/Sidebar";
import { cn, debounce } from "@/lib/utils";
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";

import { useAppStateStore } from "./hooks/use-app-state-store";
import { useGitStore } from "./hooks/useGitStore";

interface ComponentGraphProps {
  projectPath: string;
}

const ComponentGraph = ({ projectPath }: ComponentGraphProps) => {
  const selectedSubProject = useAppStateStore((s) => s.selectedSubProject);
  const setSelectedSubProject = useAppStateStore(
    (s) => s.setSelectedSubProject,
  );
  const selectedId = useAppStateStore((s) => s.selectedId);
  const setSelectedId = useAppStateStore((s) => s.setSelectedId);
  const centeredItemId = useAppStateStore((s) => s.centeredItemId);
  const setCenteredItemId = useAppStateStore((s) => s.setCenteredItemId);
  const isSidebarOpen = useAppStateStore((s) => s.isSidebarOpen);
  const setIsSidebarOpen = useAppStateStore((s) => s.setIsSidebarOpen);
  const setViewport = useAppStateStore((s) => s.setViewport);
  const loadState = useAppStateStore((s) => s.loadState);
  const saveState = useAppStateStore((s) => s.saveState);
  const resetState = useAppStateStore((s) => s.reset);
  const isLoaded = useAppStateStore((s) => s.isLoaded);

  const status = useGitStore((s) => s.status);
  const selectedCommit = useGitStore((s) => s.selectedCommit);
  const loadAnalyzedDiff = useGitStore((s) => s.loadAnalyzedDiff);

  const subPath = useMemo(() => {
    return selectedSubProject &&
      selectedSubProject !== projectPath &&
      selectedSubProject.startsWith(projectPath)
      ? selectedSubProject.replace(projectPath, "").replace(/^[/\\]/, "")
      : undefined;
  }, [selectedSubProject, projectPath]);

  const [size, setSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  const [graphData, setGraphData] = useState<useGraphProps>({
    nodes: [],
    edges: [],
    combos: [],
  });

  const [search, setSearch] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [matches, setMatches] = useState<string[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const [typeData, settypeData] = useState<{ [key: string]: TypeDataDeclare }>(
    {},
  );

  const rendererRef = useRef<GraphRenderer | null>(null);
  const graphContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const hasRestoredViewport = useRef(false);

  const rawGraphDataRef = useRef<JsonData | null>(null);

  const loadData = useCallback(
    async (analysisPath?: string) => {
      const targetPath = analysisPath || selectedSubProject || projectPath;
      if (!targetPath) return;

      try {
        let graphData: JsonData;
        if (selectedCommit) {
          const diffData = await loadAnalyzedDiff(
            projectPath,
            selectedCommit,
            subPath,
          );
          if (!diffData) return;
          graphData = diffData;
        } else {
          graphData = (await window.ipcRenderer.invoke(
            "read-graph-data",
            projectPath,
            targetPath,
          )) as JsonData;
        }

        if (!graphData) throw new Error("Graph data not found");
        rawGraphDataRef.current = graphData;

        const {
          added = [],
          modified = [],
          deleted = [],
          deletedObjects = {},
        } = graphData.diff || {};

        const combos: ComboData[] = [];
        const nodes: NodeData[] = [];
        const edges: EdgeData[] = [];

        const addCombo = (
          variable: ComponentFileVar,
          filePath: string,
          parentID?: string,
        ) => {
          if (variable.kind != "component") return;
          const fileName = `${graphData.src}${filePath}`;

          const combo: ComboData = {
            id: variable.id,
            collapsed: true,
            name: variable.name,
            label: { text: getDisplayName(variable.name), fill: "black" },
            combo: parentID,
            fileName: `${fileName}:${variable.loc.line}:${variable.loc.column}`,
            pureFileName: filePath,
            scope: variable.scope,
            props: variable.props,
            propType: variable.propType,
            type: "component",
            ui: variable.ui,
            renders: variable.renders,
          };

          if (added.includes(variable.id)) combo.gitStatus = "added";
          else if (modified.includes(variable.id)) combo.gitStatus = "modified";
          else if (deleted.includes(variable.id)) combo.gitStatus = "deleted";

          combos.push(combo);

          const propsComboId = `${variable.id}-props`;
          const propNodes: NodeData[] = [];
          const propCombos: ComboData[] = [];

          const addProps = (props: PropData[], parentComboId: string) => {
            for (const prop of props) {
              if (added.includes(prop.id)) prop.gitStatus = "added";
              else if (modified.includes(prop.id)) prop.gitStatus = "modified";
              else if (deleted.includes(prop.id)) prop.gitStatus = "deleted";

              if (prop.props && prop.props.length > 0) {
                const subPropsComboId = `${prop.id}-subprops`;
                const subPropsCombo: ComboData = {
                  id: subPropsComboId,
                  collapsed: true,
                  name: { type: "identifier", name: prop.name },
                  label: { text: prop.name, fill: "black" },
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
                const propNode: NodeData = {
                  id: prop.id,
                  name: { type: "identifier", name: prop.name },
                  label: {
                    text: (prop.kind === "spread" ? "..." : "") + prop.name,
                  },
                  type: "prop",
                  color: "green",
                  combo: parentComboId,
                  fileName: `${fileName}:${variable.loc.line}:${variable.loc.column}`,
                  pureFileName: filePath,
                };

                if (added.includes(prop.id)) propNode.gitStatus = "added";
                else if (modified.includes(prop.id))
                  propNode.gitStatus = "modified";
                else if (deleted.includes(prop.id))
                  propNode.gitStatus = "deleted";

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
                obj.kind === "component" &&
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
            const propsCombo: ComboData = {
              id: propsComboId,
              collapsed: true,
              name: { type: "identifier", name: "props" },
              label: { text: "props", fill: "black" },
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
                propsCombo.gitStatus = statuses[0];
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

              console.log("deleted", v);

              let name: VariableName;
              if (v.kind === "prop" || v.kind === "spread") {
                name = { type: "identifier", name: (v as PropData).name };
              } else if (v.kind === "effect") {
                name = { type: "identifier", name: "effect" };
              } else {
                name = (v as ComponentFileVar).name;
              }

              const nodeBase: NodeData = {
                id: v.id,
                name: name,
                combo: variable.id,
                fileName: `${fileName}:${loc.line}:${loc.column}`,
                pureFileName: filePath,
                loc: loc,
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

          combos.push({
            id: `${variable.id}-render`,
            collapsed: true,
            name: { type: "identifier", name: "render" },
            label: { text: "render", fill: "black" },
            combo: variable.id,
            fileName: `${fileName}:${variable.loc.line}:${variable.loc.column}`,
            pureFileName: filePath,
            ui: variable.ui?.renders?.[`${variable.id}-render`],
          });

          const isPropNode = (props: PropData[], id: string): boolean => {
            for (const p of props) {
              if (p.id === id) return true;
              if (p.props && isPropNode(p.props, id)) return true;
            }
            return false;
          };

          for (const v of Object.values(variable.var)) {
            const nodeBase: NodeData = {
              id: v.id,
              name: v.name,
              combo: variable.id,
              fileName: `${fileName}:${v.loc.line}:${v.loc.column}`,
              pureFileName: filePath,
              loc: v.loc,
              ui: v.ui,
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
            } else if (v.kind == "memo") {
              nodes.push({
                ...nodeBase,
                label: {
                  text: getDisplayName(v.name),
                },
                type: "memo",
                color: "red",
              });

              for (const dep of v.reactDeps) {
                const isProp = isPropNode(variable.props || [], dep.id);
                edges.push({
                  id: `${dep.id}-${v.id}`,
                  source: dep.id,
                  target: v.id,
                  combo: isProp ? undefined : variable.id,
                });
              }
            } else if (v.kind == "ref") {
              nodes.push({
                ...nodeBase,
                label: {
                  text: getDisplayName(v.name),
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
                    id: `${id}-${v.id}`,
                    source: id,
                    target: v.id,
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

              addRefDefaultDependency(v.defaultData);
            }
          }

          for (const effect of Object.values(variable.effects)) {
            const effectNode: NodeData = {
              id: effect.id,
              name: { type: "identifier", name: "effect" },
              type: "effect",
              color: "yellow",
              combo: variable.id,
              fileName: `${fileName}:${effect.loc.line}:${effect.loc.column}`,
              pureFileName: filePath,
              loc: effect.loc,
              ui: variable.ui?.renders?.[effect.id],
            };

            if (added.includes(effect.id)) effectNode.gitStatus = "added";
            else if (modified.includes(effect.id))
              effectNode.gitStatus = "modified";
            else if (deleted.includes(effect.id))
              effectNode.gitStatus = "deleted";

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

          for (const render of Object.values(variable.renders)) {
            for (const file of Object.values(graphData.files)) {
              if (Object.prototype.hasOwnProperty.call(file.var, render.id)) {
                const v = file.var[render.id];
                const renderNode: NodeData = {
                  id: `${variable.id}-render-${render.id}`,
                  name: v.name,
                  label: {
                    text: getDisplayName(v.name),
                  },
                  combo: `${variable.id}-render`,
                  fileName: `${fileName}:${render.loc.line}:${render.loc.column}`,
                  pureFileName: file.path,
                  loc: render.loc,
                  ui: variable.ui?.renders?.[render.id],
                };

                // For render nodes, check if the component being rendered was changed
                if (added.includes(v.id)) renderNode.gitStatus = "added";
                else if (modified.includes(v.id))
                  renderNode.gitStatus = "modified";
                else if (deleted.includes(v.id))
                  renderNode.gitStatus = "deleted";

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

          for (const v of Object.values(variable.var)) {
            addCombo(v, filePath, variable.id);
          }
        };

        const newTypeData: { [key: string]: TypeDataDeclare } = {};
        for (const file of Object.values(graphData.files)) {
          const addAllComponents = (
            vars: Record<string, ComponentFileVar>,
            parentID?: string,
          ) => {
            for (const variable of Object.values(vars)) {
              if (variable.kind === "component") {
                addCombo(variable, file.path, parentID);
              }
              if ("var" in variable && variable.var) {
                addAllComponents(
                  variable.var,
                  variable.kind === "component" ? variable.id : parentID,
                );
              }
            }
          };

          addAllComponents(file.var);

          if (file.tsTypes) {
            for (const typeDeclare of Object.values(file.tsTypes)) {
              newTypeData[typeDeclare.id] = typeDeclare;
            }
          }
        }

        // Add ALL deleted items from deletedObjects
        Object.keys(deletedObjects).forEach((deletedId) => {
          const obj = deletedObjects[deletedId];
          if (!obj) return;

          if ("kind" in obj && obj.kind === "component") {
            // Add component as combo
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
              console.log("add delete", deletedId, parentId);

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

              const nodeBase: NodeData = {
                id: obj.id,
                name: name,
                combo: comboId,
                fileName: loc
                  ? `${graphData.src}${filePath}:${loc.line}:${loc.column}`
                  : "",
                pureFileName: filePath,
                loc: loc,
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

        settypeData(newTypeData);

        for (const e of Object.values(graphData.edges)) {
          if (e.label === "render") continue;

          edges.push({
            id: `${e.from}-${e.to}`,
            source: e.from,
            target: e.to,
          });
        }

        setGraphData({
          nodes,
          edges,
          combos,
        });
      } catch (err) {
        console.error(err);
      }
    },
    [
      projectPath,
      selectedSubProject,
      selectedCommit,
      loadAnalyzedDiff,
      subPath,
    ],
  );

  const graph = useGraph({
    ...graphData,
    projectPath,
    targetPath: selectedSubProject || projectPath,
  });

  const highlightGitChanges = useCallback(async () => {
    if (!graph || !rawGraphDataRef.current) return;

    try {
      const combos = graph.getAllCombos();
      const nodes = graph.getAllNodes();

      const {
        added = [],
        modified = [],
        deleted = [],
      } = rawGraphDataRef.current.diff || {};

      graph.batch(() => {
        const applyStatus = (item: ComboGraphData | NodeGraphData) => {
          if (added.includes(item.id)) {
            item.gitStatus = "added";
          } else if (modified.includes(item.id)) {
            item.gitStatus = "modified";
          } else if (deleted.includes(item.id)) {
            item.gitStatus = "deleted";
          } else {
            item.gitStatus = undefined;
          }

          // Everything in the current graph should be visible
          item.visible = true;

          if ("collapsedRadius" in item)
            graph.updateCombo(item as ComboGraphData);
          else graph.updateNode(item as NodeGraphData);
        };

        combos.forEach(applyStatus);
        nodes.forEach(applyStatus);
      });
    } catch (e) {
      console.error("Failed to highlight git changes", e);
    }
  }, [graph]);

  useEffect(() => {
    highlightGitChanges();
  }, [highlightGitChanges, status, selectedCommit]);

  const onSelect = useCallback(
    (id: string) => {
      setSelectedId(id);
      setCenteredItemId(id);
    },
    [setSelectedId, setCenteredItemId],
  );

  useEffect(() => {
    const savePositions = debounce(() => {
      const allNodes = graph.getAllNodes();
      const allCombos = graph.getAllCombos();
      const positions: Record<
        string,
        { x: number; y: number; radius?: number }
      > = {};

      allNodes.forEach((n) => {
        if (n.x !== undefined && n.y !== undefined) {
          positions[n.id] = { x: n.x, y: n.y };
        }
      });
      allCombos.forEach((c) => {
        if (c.x !== undefined && c.y !== undefined) {
          positions[c.id] = {
            x: c.x,
            y: c.y,
            radius: c.expandedRadius || c.radius,
          };
        }
      });

      const targetPath = selectedSubProject || projectPath;
      if (Object.keys(positions).length > 0) {
        window.ipcRenderer.invoke(
          "update-graph-position",
          projectPath,
          targetPath,
          positions,
        );
      }
    }, 1000);

    const unbind = graph.bind((data) => {
      if (
        data.type === "combo-drag-move" ||
        data.type === "node-drag-move" ||
        data.type === "combo-drag-end" ||
        data.type === "node-drag-end" ||
        data.type === "layout-change" ||
        data.type === "child-moved"
      ) {
        savePositions();
      }
    });

    return () => {
      graph.unbind(unbind);
    };
  }, [graph, projectPath, selectedSubProject]);

  // Initialize/Update Renderer
  useEffect(() => {
    if (!graphContainerRef.current) return;
    if (size.width === 0 || size.height === 0) return;

    if (!rendererRef.current) {
      rendererRef.current = new GraphRenderer(
        graphContainerRef.current,
        graph,
        size.width,
        size.height,
        onSelect,
        (vp) => {
          if (!rendererRef.current?.viewportChangeInProgress) {
            setViewport(vp);
          }
        },
      );
    } else {
      rendererRef.current.resize(size.width, size.height);
      rendererRef.current.onSelect = onSelect;
    }

    if (rendererRef.current && !hasRestoredViewport.current && isLoaded) {
      const savedViewport = useAppStateStore.getState().viewport;
      if (savedViewport) {
        rendererRef.current.setViewport(
          savedViewport.x,
          savedViewport.y,
          savedViewport.zoom,
        );
      }
      hasRestoredViewport.current = true;
    }
  }, [graph, size.width, size.height, onSelect, isLoaded, setViewport]);

  // Clean up
  useEffect(() => {
    return () => {
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (
      graphData.edges?.length == 0 ||
      graphData.combos?.length == 0 ||
      graphData.nodes?.length == 0
    )
      return;
    const time = performance.now();
    graph.render();
    console.log("layout", performance.now() - time);

    // After render, center on saved item if it exists AND we haven't restored a viewport
    if (centeredItemId && !hasRestoredViewport.current) {
      setTimeout(() => {
        graph.expandAncestors(centeredItemId);
        rendererRef.current?.focusItem(centeredItemId, 1.5);
        hasRestoredViewport.current = true; // Mark as done so we don't jump again
      }, 100);
    }
  }, [graphData]);

  // Initial load state
  useEffect(() => {
    hasRestoredViewport.current = false; // Reset flag when project changes
    resetState();
    loadState(projectPath);
  }, [projectPath, loadState, resetState]);

  // Auto-save state
  const debouncedSaveState = useMemo(
    () => debounce(saveState, 1000),
    [saveState],
  );

  useEffect(() => {
    debouncedSaveState(projectPath);
  }, [
    projectPath,
    selectedSubProject,
    centeredItemId,
    isSidebarOpen,
    debouncedSaveState,
  ]);

  // load data whenever sub-project selection or selected commit changes
  useEffect(() => {
    loadData();
  }, [selectedSubProject, selectedCommit, loadData]);

  // Resize observer for container
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!containerRef.current) return;
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setSize({ width, height });
      }
    });
    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  // Force re-calculation of size when sidebar toggles
  useEffect(() => {
    if (containerRef.current) {
      const { width, height } = containerRef.current.getBoundingClientRect();
      setSize({ width, height });
    }
  }, [isSidebarOpen]);

  // handle global shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        if (isSearchOpen) {
          searchInputRef.current?.select();
        } else {
          setIsSearchOpen(true);
        }
      }
      if (e.key === "Escape") {
        setIsSearchOpen(false);
      }
      if (isSearchOpen && e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) {
          goToPrevMatch();
        } else {
          goToNextMatch();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isSearchOpen, matches, currentMatchIndex]);

  // Focus and select search input when opened
  useEffect(() => {
    if (isSearchOpen) {
      // Small delay to ensure the input is rendered and focused
      setTimeout(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }, 10);
    }
  }, [isSearchOpen]);

  // Debounce search input
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
    }, 200);
    return () => clearTimeout(handler);
  }, [search]);

  // Trigger search when debounced value changes
  useEffect(() => {
    performSearch(debouncedSearch);
  }, [debouncedSearch]);

  const performSearch = (value: string) => {
    let firstMatchId: string | null = null;
    const newMatches: string[] = [];

    graph.batch(() => {
      if (value === "") {
        setMatches([]);
        setCurrentMatchIndex(-1);
        resetHighlights();
        return;
      }

      const lowerValue = value.toLowerCase();

      const combos = graph.getAllCombos();
      for (const combo of combos) {
        if (combo.id.endsWith("-render")) continue;

        const isMatch = combo.label?.text.toLowerCase().includes(lowerValue);
        if (isMatch) {
          if (!combo.highlighted) {
            combo.highlighted = true;
            graph.updateCombo(combo);
          }
          newMatches.push(combo.id);
        } else if (combo.highlighted) {
          combo.highlighted = false;
          graph.updateCombo(combo);
        }
      }

      const nodes = graph.getAllNodes();
      for (const node of nodes) {
        const isMatch = node.label?.text.toLowerCase().includes(lowerValue);
        if (isMatch) {
          if (!node.highlighted) {
            node.highlighted = true;
            graph.updateNode(node);
          }
          newMatches.push(node.id);
        } else if (node.highlighted) {
          node.highlighted = false;
          graph.updateNode(node);
        }
      }

      if (newMatches.length > 0) {
        firstMatchId = newMatches[0];
      }
    });

    setMatches(newMatches);
    if (newMatches.length > 0) {
      setCurrentMatchIndex(0);
      setSelectedId(firstMatchId);
      // Small timeout to allow the batch render to complete before starting expansion animations
      setTimeout(() => {
        if (firstMatchId) {
          graph.expandAncestors(firstMatchId);
          rendererRef.current?.focusItem(firstMatchId, 1.5);
        }
      }, 50);
    } else {
      setCurrentMatchIndex(-1);
    }
  };

  const onSearch = (value: string) => {
    setSearch(value);
  };

  const resetHighlights = () => {
    const combos = graph.getAllCombos();
    for (const combo of Object.values(combos)) {
      if (combo.highlighted) {
        combo.highlighted = false;
        graph.updateCombo(combo);
      }
    }
    const nodes = graph.getAllNodes();
    for (const node of Object.values(nodes)) {
      if (node.highlighted) {
        node.highlighted = false;
        graph.updateNode(node);
      }
    }
  };

  const goToNextMatch = () => {
    if (matches.length === 0) return;
    const nextIndex = (currentMatchIndex + 1) % matches.length;
    setCurrentMatchIndex(nextIndex);
    graph.expandAncestors(matches[nextIndex]);
    rendererRef.current?.focusItem(matches[nextIndex], 1.5);
    setSelectedId(matches[nextIndex]);
  };

  const goToPrevMatch = () => {
    if (matches.length === 0) return;
    const prevIndex = (currentMatchIndex - 1 + matches.length) % matches.length;
    setCurrentMatchIndex(prevIndex);
    graph.expandAncestors(matches[prevIndex]);
    rendererRef.current?.focusItem(matches[prevIndex], 1.5);
    setSelectedId(matches[prevIndex]);
  };

  const handleReloadProject = useCallback(async () => {
    const targetPath = selectedSubProject || projectPath;
    if (!targetPath) return;

    setIsAnalyzing(true);
    try {
      await window.ipcRenderer.invoke(
        "analyze-project",
        targetPath,
        projectPath,
      );
      await loadData();
    } catch (e) {
      console.error("Failed to reload project", e);
    } finally {
      setIsAnalyzing(false);
    }
  }, [selectedSubProject, projectPath, loadData]);

  useEffect(() => {
    const unsubscribe = window.ipcRenderer.on("reload-project", () => {
      handleReloadProject();
    });
    return () => {
      unsubscribe();
    };
  }, [handleReloadProject]);

  const nodesMap = useMemo(() => {
    if (!selectedId) return {};
    const nodes = graph.getAllNodes();
    return Object.fromEntries(nodes.map((n) => [n.id, n]));
  }, [selectedId, graph]);

  const combosMap = useMemo(() => {
    if (!selectedId) return {};
    const combos = graph.getAllCombos();
    return Object.fromEntries(combos.map((c) => [c.id, c]));
  }, [selectedId, graph]);

  const handleClose = useCallback(() => {
    setSelectedId(null);
  }, [setSelectedId]);

  const handleProjectSwitch = async (path: string) => {
    if (path === selectedSubProject) return; // No change

    setIsAnalyzing(true);
    setSelectedSubProject(path);
    try {
      // Trigger analysis on new path, storing config in projectRoot
      await window.ipcRenderer.invoke("analyze-project", path, projectPath);

      // Data will be reloaded by the useEffect watching loadData/selectedSubProject
    } catch (e) {
      console.error("Failed to switch project", e);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleLocateFile = useCallback(
    (filePath: string) => {
      const nodes = graph.getAllNodes();
      const combos = graph.getAllCombos();

      const match =
        combos.find((c) => c.pureFileName === filePath) ||
        nodes.find((n) => n.fileName?.startsWith(filePath));

      if (match) {
        onSelect(match.id);
      }
    },
    [graph, onSelect],
  );

  return (
    <div className="w-screen h-screen relative bg-background overflow-hidden">
      <SidebarProvider open={isSidebarOpen} onOpenChange={setIsSidebarOpen}>
        <MemoizedProjectSidebar
          currentPath={selectedSubProject || projectPath}
          projectRoot={projectPath}
          onSelectProject={handleProjectSwitch}
          onLocateFile={handleLocateFile}
          isLoading={isAnalyzing}
        />
        <SidebarInset className="min-w-0">
          <SidebarTrigger
            className={cn(
              "absolute top-4 left-4 z-50",
              // isSidebarOpen && "hidden",
            )}
          />
          <MemoizedNodeDetails
            selectedId={selectedId}
            nodes={nodesMap}
            combos={combosMap}
            typeData={typeData}
            projectPath={projectPath}
            onClose={handleClose}
          />
          {isSearchOpen && (
            <div className="absolute top-4 right-4 z-50 flex items-center bg-popover border border-border rounded shadow-lg p-1 animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="flex items-center gap-1">
                <div className="relative flex items-center">
                  <input
                    ref={searchInputRef}
                    autoFocus
                    type="text"
                    value={search}
                    placeholder="Find"
                    onChange={(e) => onSearch(e.target.value)}
                    className="bg-muted text-foreground pl-2 pr-16 py-1 outline-none text-sm w-64 border border-transparent focus:border-primary rounded-sm placeholder:text-muted-foreground"
                  />
                  <div className="absolute right-2 text-[11px] text-muted-foreground pointer-events-none">
                    {matches.length > 0 ? (
                      <span className="text-foreground">
                        {currentMatchIndex + 1} of {matches.length}
                      </span>
                    ) : search !== "" ? (
                      <span className="text-destructive">No results</span>
                    ) : null}
                  </div>
                </div>

                <div className="flex items-center border-l border-border pl-1 gap-1">
                  <button
                    onClick={goToPrevMatch}
                    className="p-1 hover:bg-accent hover:text-accent-foreground rounded-sm text-muted-foreground transition-colors"
                    title="Previous Match (Shift+Enter)"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="currentColor"
                    >
                      <path d="M7.707 5.293a1 1 0 0 1 1.414 0l4 4a1 1 0 0 1-1.414 1.414L8 7.414l-3.707 3.707a1 1 0 0 1-1.414-1.414l4-4z" />
                    </svg>
                  </button>
                  <button
                    onClick={goToNextMatch}
                    className="p-1 hover:bg-accent hover:text-accent-foreground rounded-sm text-muted-foreground transition-colors"
                    title="Next Match (Enter)"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="currentColor"
                    >
                      <path d="M7.707 10.707a1 1 0 0 0 1.414 0l4-4a1 1 0 0 0-1.414-1.414L8 8.586l-3.707-3.707a1 1 0 0 0-1.414 1.414l4 4z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setIsSearchOpen(false)}
                    className="p-1 hover:bg-accent hover:text-accent-foreground rounded-sm text-muted-foreground transition-colors ml-1"
                    title="Close (Esc)"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="currentColor"
                    >
                      <path d="M1.293 1.293a1 1 0 0 1 1.414 0L8 6.586l5.293-5.293a1 1 0 1 1 1.414 1.414L9.414 8l5.293 5.293a1 1 0 0 1-1.414 1.414L8 9.414l-5.293 5.293a1 1 0 0 1-1.414-1.414L8 9.414l-5.293 5.293a1 1 0 0 1-1.414-1.414L6.586 8 1.293 2.707a1 1 0 0 1 0-1.414z" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          )}
          <div
            ref={containerRef}
            className="flex flex-1 flex-col h-full overflow-hidden relative min-w-0"
          >
            <div className="absolute inset-0" ref={graphContainerRef} />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
};

const MemoizedProjectSidebar = React.memo(ProjectSidebar);
const MemoizedNodeDetails = React.memo(NodeDetails);

export default ComponentGraph;
