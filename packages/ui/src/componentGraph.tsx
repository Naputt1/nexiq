import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ComponentFile,
  ComponentFileVar,
  PropData,
  PropDataType,
  TypeDataDeclare,
} from "shared";
import useGraph, {
  type ComboData,
  type EdgeData,
  type NodeData,
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

interface ComponentGraphProps {
  projectPath: string;
}

const ComponentGraph = ({ projectPath }: ComponentGraphProps) => {
  const {
    selectedSubProject,
    setSelectedSubProject,
    selectedId,
    setSelectedId,
    centeredItemId,
    setCenteredItemId,
    isSidebarOpen,
    setIsSidebarOpen,
    viewport,
    setViewport,
    loadState,
    saveState,
    isLoaded,
  } = useAppStateStore();

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

  const loadData = useCallback(
    async (analysisPath?: string) => {
      const targetPath = analysisPath || selectedSubProject || projectPath;
      if (!targetPath) return;

      try {
        // Use configRoot (projectPath) to read data because that's where .react-map is
        const graphData = await window.ipcRenderer.invoke(
          "read-graph-data",
          projectPath,
          targetPath,
        );
        if (!graphData) throw new Error("Graph data not found");

        const combos: ComboData[] = [];
        const nodes: NodeData[] = [];
        const edges: EdgeData[] = [];

        const addCombo = (
          variable: ComponentFileVar,
          file: ComponentFile,
          parentID?: string,
        ) => {
          if (variable.kind != "component") return;
          const fileName = `${graphData.src}${file.path}`;

          combos.push({
            id: variable.id,
            collapsed: true,
            label: { text: variable.name, fill: "black" },
            combo: parentID,
            fileName: `${fileName}:${variable.loc.line}:${variable.loc.column}`,
            props: variable.props,
            propType: variable.propType,
            type: "component",
            ui: variable.ui,
            renders: variable.renders,
          });

          if (variable.props && variable.props.length > 0) {
            const propsComboId = `${variable.id}-props`;
            combos.push({
              id: propsComboId,
              collapsed: true,
              label: { text: "props", fill: "black" },
              color: "green",
              combo: variable.id,
              fileName: `${fileName}:${variable.loc.line}:${variable.loc.column}`,
              ui: variable.ui?.renders?.[propsComboId],
            });

            const addProps = (props: PropData[], parentComboId: string) => {
              for (const prop of props) {
                if (prop.props && prop.props.length > 0) {
                  const subPropsComboId = `${prop.id}-subprops`;
                  combos.push({
                    id: subPropsComboId,
                    collapsed: true,
                    label: { text: prop.name, fill: "black" },
                    color: "green",
                    combo: parentComboId,
                    fileName: `${fileName}:${variable.loc.line}:${variable.loc.column}`,
                    ui: variable.ui?.renders?.[subPropsComboId],
                  });
                  addProps(prop.props, subPropsComboId);
                } else {
                  nodes.push({
                    id: prop.id,
                    label: {
                      text: (prop.kind === "spread" ? "..." : "") + prop.name,
                    },
                    type: "prop",
                    color: "green",
                    combo: parentComboId,
                    propData: prop,
                    fileName: `${fileName}:${variable.loc.line}:${variable.loc.column}`,
                  });
                }
              }
            };

            addProps(variable.props, propsComboId);
          }

          combos.push({
            id: `${variable.id}-render`,
            collapsed: true,
            label: { text: "render", fill: "black" },
            combo: variable.id,
            fileName: `${fileName}:${variable.loc.line}:${variable.loc.column}`,
            ui: variable.ui?.renders?.[`${variable.id}-render`],
          });

          const isPropNode = (props: PropData[], id: string): boolean => {
            for (const p of props) {
              if (p.id === id) return true;
              if (p.props && isPropNode(p.props, id)) return true;
            }
            return false;
          };

          // for (const stateID of variable.states) {
          //   const state = variable.var[stateID];
          //   if (state == null || state.kind !== "state") continue;

          //   nodes.push({
          //     id: state.id,
          //     label: {
          //       text: state.value,
          //     },
          //     type: "state",
          //     color: "red",
          //     combo: variable.id,
          //     fileName: `${fileName}:${state.loc.line}:${state.loc.column}`,
          //     ui: state.ui,
          //   });
          // }

          for (const v of Object.values(variable.var)) {
            if (v.kind == "state") {
              nodes.push({
                id: v.id,
                label: {
                  text: v.value,
                },
                type: "state",
                color: "red",
                combo: variable.id,
                fileName: `${fileName}:${v.loc.line}:${v.loc.column}`,
                ui: v.ui,
              });
            } else if (v.kind == "memo") {
              nodes.push({
                id: v.id,
                label: {
                  text: v.name,
                },
                type: "memo",
                color: "red",
                combo: variable.id,
                fileName: `${fileName}:${v.loc.line}:${v.loc.column}`,
                ui: v.ui,
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
                id: v.id,
                label: {
                  text: v.name,
                },
                type: "ref",
                color: "red",
                combo: variable.id,
                fileName: `${fileName}:${v.loc.line}:${v.loc.column}`,
                ui: v.ui,
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
            nodes.push({
              id: effect.id,
              type: "effect",
              color: "yellow",
              combo: variable.id,
              fileName: `${fileName}:${effect.loc.line}:${effect.loc.column}`,
              ui: variable.ui?.renders?.[effect.id],
            });

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
                nodes.push({
                  id: `${variable.id}-render-${render.id}`,
                  label: {
                    text: v.name,
                  },
                  combo: `${variable.id}-render`,
                  fileName: `${fileName}:${render.loc.line}:${render.loc.column}`,
                  ui: variable.ui?.renders?.[render.id],
                });

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
            addCombo(v, file, variable.id);
          }
        };

        const newTypeData: { [key: string]: TypeDataDeclare } = {};
        for (const file of Object.values(graphData.files)) {
          for (const variable of Object.values(file.var)) {
            addCombo(variable, file);
          }

          if (file.tsTypes) {
            for (const typeDeclare of Object.values(file.tsTypes)) {
              newTypeData[typeDeclare.id] = typeDeclare;
            }
          }
        }

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
    [projectPath, selectedSubProject],
  );

  const graph = useGraph({
    ...graphData,
    projectPath,
    targetPath: selectedSubProject || projectPath,
  });

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
          setViewport(vp);
        },
      );
    } else {
      rendererRef.current.resize(size.width, size.height);
      rendererRef.current.onSelect = onSelect;
    }

    if (
      rendererRef.current &&
      viewport &&
      !hasRestoredViewport.current &&
      isLoaded
    ) {
      rendererRef.current.setViewport(viewport.x, viewport.y, viewport.zoom);
      hasRestoredViewport.current = true;
    }
  }, [graph, size.width, size.height, onSelect, viewport, isLoaded]);

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
    loadState(projectPath);
  }, [projectPath, loadState]);

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
    viewport,
    debouncedSaveState,
  ]);

  // load data whenever sub-project selection changes
  useEffect(() => {
    if (selectedSubProject) {
      loadData();
    }
  }, [selectedSubProject, loadData]);

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

  return (
    <div className="w-screen h-screen relative bg-background overflow-hidden">
      <SidebarProvider open={isSidebarOpen} onOpenChange={setIsSidebarOpen}>
        <ProjectSidebar
          currentPath={selectedSubProject || projectPath}
          projectRoot={projectPath}
          onSelectProject={handleProjectSwitch}
          isLoading={isAnalyzing}
        />
        <SidebarInset className="min-w-0">
          <SidebarTrigger
            className={cn(
              "absolute top-4 left-4 z-50",
              // isSidebarOpen && "hidden",
            )}
          />
          <NodeDetails
            selectedId={selectedId}
            nodes={nodesMap}
            combos={combosMap}
            typeData={typeData}
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
                      <path d="M1.293 1.293a1 1 0 0 1 1.414 0L8 6.586l5.293-5.293a1 1 0 1 1 1.414 1.414L9.414 8l5.293 5.293a1 1 0 0 1-1.414 1.414L8 9.414l-5.293 5.293a1 1 0 0 1-1.414-1.414L6.586 8 1.293 2.707a1 1 0 0 1 0-1.414z" />
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

export default ComponentGraph;
