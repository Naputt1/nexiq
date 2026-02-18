import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type TypeDataDeclare, type JsonData } from "shared";
import useGraph, {
  GraphCombo,
  GraphNode,
  type useGraphProps,
} from "./graph/hook";
import { GraphRenderer } from "./graph/renderer";
import { ProjectSidebar } from "./components/Sidebar";
import { RightSidebar } from "./components/RightSidebar";
import { ZoomSlider } from "./components/ZoomSlider";
import { cn, debounce } from "@/lib/utils";
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "./components/ui/resizable";
import { useDefaultLayout } from "react-resizable-panels";

import { setupAutoSave, useAppStateStore } from "./hooks/use-app-state-store";
import type { GraphViewType } from "../electron/types";
import { useGitStore } from "./hooks/useGitStore";
import { useConfigStore } from "./hooks/use-config-store";
import { generateComponentGraphData, type GraphViewGenerator } from "./views";
import ViewWorker from "./views/view.worker?worker";
import { Loader2 } from "lucide-react";

const VIEW_GENERATORS: Record<GraphViewType, GraphViewGenerator> = {
  component: generateComponentGraphData,
};

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
  const selectedCommit = useAppStateStore((s) => s.selectedCommit);
  const activeTab = useAppStateStore((s) => s.activeTab);
  const setViewport = useAppStateStore((s) => s.setViewport);
  const loadState = useAppStateStore((s) => s.loadState);
  const resetState = useAppStateStore((s) => s.reset);
  const isLoaded = useAppStateStore((s) => s.isLoaded);
  const view = useAppStateStore((s) => s.view);
  const setRightSidebarWidthRatio = useAppStateStore(
    (s) => s.setRightSidebarWidth,
  );
  const sidebarWidth = useAppStateStore((s) => s.sidebar.right.width);

  const status = useGitStore((s) => s.status);
  const loadAnalyzedDiff = useGitStore((s) => s.loadAnalyzedDiff);
  const clearAnalyzedDiffCache = useGitStore((s) => s.clearAnalyzedDiffCache);

  const viewport = useAppStateStore((s) => s.viewport);

  const [isGeneratingView, setIsGeneratingView] = useState(false);
  const workerRef = useRef<Worker | null>(null);

  // Persistence bridge for useDefaultLayout
  const storage = useMemo(
    () => ({
      getItem: () => {
        return JSON.stringify({
          main: 100 - sidebarWidth,
          sidebar: sidebarWidth,
        });
      },
      setItem: (_: string, value: string) => {
        const layout = JSON.parse(value);
        if (layout.sidebar !== undefined) {
          setRightSidebarWidthRatio(layout.sidebar);
        }
      },
    }),
    [sidebarWidth, setRightSidebarWidthRatio],
  );

  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "main-horizontal",
    panelIds: ["main", "sidebar"],
    storage,
  });

  useEffect(() => {
    workerRef.current = new ViewWorker();
    return () => {
      workerRef.current?.terminate();
    };
  }, []);

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

  const rendererRef = useRef<GraphRenderer | null>(null);

  const zoomRange = useMemo(() => {
    if (rendererRef.current) {
      return rendererRef.current.getZoomRange();
    }
    return { min: 0.1, max: 5 };
  }, [graphData]); // Re-calculate when graph data changes

  const [search, setSearch] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [matches, setMatches] = useState<string[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const [typeData, settypeData] = useState<{ [key: string]: TypeDataDeclare }>(
    {},
  );

  const graphContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const hasRestoredViewport = useRef(false);
  const { theme, customColors, fetchConfig } = useConfigStore();

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  // Use useEffect to update renderer theme when customColors or theme changes
  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setCustomColors(customColors || {});
    }
  }, [customColors, theme]);

  useEffect(() => {
    const unsubscribe = setupAutoSave(projectPath);
    return () => unsubscribe();
  }, [projectPath]);

  const rawGraphDataRef = useRef<JsonData | null>(null);

  const loadData = useCallback(
    async (analysisPath?: string) => {
      const targetPath = analysisPath || selectedSubProject || projectPath;
      if (!targetPath) return;

      try {
        let graphData: JsonData;
        if (selectedCommit || activeTab === "git") {
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

        setIsGeneratingView(true);
        if (workerRef.current) {
          workerRef.current.onmessage = (e) => {
            const {
              nodes,
              edges,
              combos,
              typeData: newTypeData,
            } = e.data.result;
            settypeData(newTypeData);
            setGraphData({ nodes, edges, combos });
            setIsGeneratingView(false);
          };
          workerRef.current.postMessage({ type: view, data: graphData });
        } else {
          // Fallback if worker not available
          const {
            nodes,
            edges,
            combos,
            typeData: newTypeData,
          } = VIEW_GENERATORS[view](graphData);

          settypeData(newTypeData);
          setGraphData({
            nodes,
            edges,
            combos,
          });
          setIsGeneratingView(false);
        }
      } catch (err) {
        console.error(err);
        setIsGeneratingView(false);
      }
    },
    [
      projectPath,
      selectedSubProject,
      selectedCommit,
      activeTab,
      loadAnalyzedDiff,
      subPath,
      view,
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
        const applyStatus = (item: GraphCombo | GraphNode) => {
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

          if ("expandedRadius" in item) graph.updateCombo(item as GraphCombo);
          else graph.updateNode(item as GraphNode);
        };

        combos.forEach(applyStatus);
        nodes.forEach(applyStatus);
      });
    } catch (e) {
      console.error("Failed to highlight git changes", e);
    }
  }, [graph]);

  const goToNextMatch = useCallback(() => {
    if (matches.length === 0) return;
    const nextIndex = (currentMatchIndex + 1) % matches.length;
    setCurrentMatchIndex(nextIndex);
    graph.expandAncestors(matches[nextIndex]);
    rendererRef.current?.focusItem(matches[nextIndex], 1.5);
    setSelectedId(matches[nextIndex]);
  }, [matches, currentMatchIndex, graph, setSelectedId]);

  const goToPrevMatch = useCallback(() => {
    if (matches.length === 0) return;
    const prevIndex = (currentMatchIndex - 1 + matches.length) % matches.length;
    setCurrentMatchIndex(prevIndex);
    graph.expandAncestors(matches[prevIndex]);
    rendererRef.current?.focusItem(matches[prevIndex], 1.5);
    setSelectedId(matches[prevIndex]);
  }, [matches, currentMatchIndex, graph, setSelectedId]);

  const resetHighlights = useCallback(() => {
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
  }, [graph]);

  const performSearch = useCallback(
    (value: string) => {
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
    },
    [graph, resetHighlights, setSelectedId],
  );

  useEffect(() => {
    highlightGitChanges();
  }, [highlightGitChanges, status, selectedCommit]);

  useEffect(() => {
    window.reactMapGraph = graph;
    window.reactMapSearch = performSearch;
  }, [graph, performSearch]);

  const onSelect = useCallback(
    (id: string, center = true, highlight = false) => {
      setSelectedId(id);
      setCenteredItemId(id);

      if (highlight) {
        resetHighlights();
        const combo = graph.getCombo(id);
        if (combo) {
          combo.highlighted = true;
          graph.updateCombo(combo);
        } else {
          const node = graph.getNode(id);
          if (node) {
            node.highlighted = true;
            graph.updateNode(node);
          }
        }
      }

      // Expand all ancestors to make sure the node is visible
      graph.expandAncestors(id);

      // Focus the viewport on the selected item
      // Small timeout to allow potential layout/expansion to finish or at least start
      if (center) {
        setTimeout(() => {
          rendererRef.current?.focusItem(id, 1.5);
        }, 50);
      }
    },
    [setSelectedId, setCenteredItemId, graph, resetHighlights],
  );

  // Clear search and highlights when search bar is closed
  useEffect(() => {
    if (!isSearchOpen) {
      setSearch("");
      setDebouncedSearch("");
      setMatches([]);
      setCurrentMatchIndex(-1);
      resetHighlights();
    }
  }, [isSearchOpen, resetHighlights]);

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
        document.documentElement.classList.contains("dark") ? "dark" : "light",
        customColors,
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
  }, [
    graph,
    size.width,
    size.height,
    onSelect,
    isLoaded,
    setViewport,
    customColors,
  ]);

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
  }, [graphData, graph]);

  useEffect(() => {
    // After render, center on saved item if it exists AND we haven't restored a viewport
    if (centeredItemId && !hasRestoredViewport.current) {
      setTimeout(() => {
        graph.expandAncestors(centeredItemId);
        rendererRef.current?.focusItem(centeredItemId, 1.5);
        hasRestoredViewport.current = true; // Mark as done so we don't jump again
      }, 100);
    }
  }, [centeredItemId, graph]);

  // Initial load state
  useEffect(() => {
    hasRestoredViewport.current = false; // Reset flag when project changes
    resetState();
    loadState(projectPath);
  }, [projectPath, loadState, resetState]);

  // load data whenever sub-project selection or selected commit changes
  useEffect(() => {
    loadData();
  }, [selectedSubProject, selectedCommit, status, graph, loadData]);

  // Resize observer for container
  const containerRef = useRef<HTMLDivElement>(null);
  // const debouncedSetSize = useMemo(() => debounce(setSize, 100), []);

  // useEffect(() => {
  //   if (!containerRef.current) return;
  //   const resizeObserver = new ResizeObserver((entries) => {
  //     for (const entry of entries) {
  //       const { width, height } = entry.contentRect;

  //       // Always tell the renderer to resize immediately (it uses RAF internally now)
  //       rendererRef.current?.resize(width, height);

  //       if (isResizingRightSidebarWidth || isResizingRightSidebarHeight) {
  //         debouncedSetSize({ width, height });
  //       } else {
  //         setSize({ width, height });
  //       }
  //     }
  //   });
  //   resizeObserver.observe(containerRef.current);
  //   return () => resizeObserver.disconnect();
  // }, [
  //   isResizingRightSidebarWidth,
  //   isResizingRightSidebarHeight,
  //   debouncedSetSize,
  // ]);

  // Force re-calculation of size when sidebar toggles or right sidebar width changes
  useEffect(() => {
    if (containerRef.current) {
      const { width, height } = containerRef.current.getBoundingClientRect();
      setSize({ width, height });
    }
  }, [isSidebarOpen, selectedId]);

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
  }, [isSearchOpen, matches, currentMatchIndex, goToNextMatch, goToPrevMatch]);

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
  }, [debouncedSearch, performSearch]);

  const onSearch = (value: string) => {
    setSearch(value);
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
      clearAnalyzedDiffCache();
      await loadData();
    } catch (e) {
      console.error("Failed to reload project", e);
    } finally {
      setIsAnalyzing(false);
    }
  }, [selectedSubProject, projectPath, loadData, clearAnalyzedDiffCache]);

  useEffect(() => {
    const unsubscribe = window.ipcRenderer.on("reload-project", () => {
      handleReloadProject();
    });
    return () => {
      unsubscribe();
    };
  }, [handleReloadProject]);

  const selectedItem = useMemo(() => {
    if (!selectedId) return undefined;
    return graph.getPointByID(selectedId);
  }, [selectedId, graph]);

  const renderNodes = useMemo(() => {
    if (!selectedId || selectedItem?.type !== "component") return [];
    const renderComboId = selectedId + "-render";
    const renderCombo = graph.getCombo(renderComboId);
    if (!renderCombo || !renderCombo.child) return [];
    return Object.values(renderCombo.child.nodes);
  }, [selectedId, selectedItem, graph]);

  const handleClose = useCallback(() => {
    setSelectedId(null);
  }, [setSelectedId]);

  const handleZoomChange = useCallback((zoom: number) => {
    rendererRef.current?.setZoom(zoom);
  }, []);

  const handleSelectNode = useCallback(
    (id: string) => {
      onSelect(id, true, true);
    },
    [onSelect],
  );

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

  const handleProjectSwitch = useCallback(
    async (path: string) => {
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
    },
    [selectedSubProject, projectPath, setSelectedSubProject],
  );

  return (
    <div className="w-screen h-screen relative bg-background overflow-hidden">
      <SidebarProvider open={isSidebarOpen} onOpenChange={setIsSidebarOpen}>
        <MemoizedProjectSidebar
          currentPath={selectedSubProject || projectPath}
          projectRoot={projectPath}
          onSelectProject={handleProjectSwitch}
          onLocateFile={handleLocateFile}
          onSelectNode={handleSelectNode}
          isLoading={isAnalyzing}
        />
        <SidebarInset className="min-w-0">
          <ResizablePanelGroup
            orientation="horizontal"
            className="h-full w-full overflow-hidden"
            defaultLayout={defaultLayout}
            onLayoutChanged={onLayoutChanged}
          >
            <ResizablePanel id="main" minSize="30%">
              <div className="flex-1 relative min-w-0 h-full">
                <SidebarTrigger
                  className={cn(
                    "absolute top-4 left-4 z-50",
                    // isSidebarOpen && "hidden",
                  )}
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
                  className="w-full h-full overflow-hidden relative min-w-0"
                >
                  <div className="absolute inset-0" ref={graphContainerRef} />
                  {/* {(isResizingRightSidebarWidth ||
                    isResizingRightSidebarHeight) && (
                    <div
                      className={cn(
                        "absolute inset-0 z-[100] bg-transparent",
                        // isResizingRightSidebarWidth
                        //   ? "cursor-ew-resize"
                        //   :
                        "cursor-ns-resize",
                      )}
                    />
                  )} */}
                  {isGeneratingView && (
                    <div className="absolute inset-0 z-[110] bg-background/50 backdrop-blur-sm flex flex-col items-center justify-center gap-4">
                      <Loader2 className="h-10 w-10 animate-spin text-primary" />
                      <span className="text-sm font-medium text-muted-foreground animate-pulse">
                        Generating graph view...
                      </span>
                    </div>
                  )}
                  {/* Zoom Slider */}
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 z-[60]">
                    <ZoomSlider
                      value={viewport?.zoom || 1}
                      min={zoomRange.min}
                      max={zoomRange.max}
                      onChange={handleZoomChange}
                    />
                  </div>
                </div>
              </div>
            </ResizablePanel>
            {selectedId && (
              <>
                <ResizableHandle withHandle />
                <ResizablePanel id="sidebar" minSize="15%" maxSize="50%">
                  <RightSidebar
                    selectedId={selectedId}
                    graph={graph}
                    typeData={typeData}
                    projectPath={projectPath}
                    onClose={handleClose}
                    onSelect={handleSelectNode}
                    renderNodes={renderNodes}
                  />
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
};

const MemoizedProjectSidebar = React.memo(ProjectSidebar);

export default ComponentGraph;
