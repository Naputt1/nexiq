import { useEffect, useRef, useState } from "react";
import type { ComponentFile, ComponentFileVar, JsonData } from "shared";
import useGraph, {
  type ComboData,
  type EdgeData,
  type NodeData,
  type useGraphProps,
} from "./graph/hook";
import Graph, { type GraphRef } from "./graph/graph";

const CusKonvoTestHook = () => {
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
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [matches, setMatches] = useState<string[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1);
  const graphRef = useRef<GraphRef>(null);

  const loadData = async () => {
    try {
      const res = await fetch("/public/graph.json");
      if (!res.ok) throw new Error("graph.json not found");
      const graphData: JsonData = await res.json();

      const combos: ComboData[] = [];
      const nodes: NodeData[] = [];

      const addCombo = (
        variable: ComponentFileVar,
        file: ComponentFile,
        parentID?: string
      ) => {
        if (!variable.isComponent) return;
        const fileName = `${graphData.src}${file.path}`;

        combos.push({
          id: variable.id,
          collapsed: true,
          label: { text: variable.name, fill: "white" },
          combo: parentID,
          fileName: `${fileName}:${variable.loc.line}:${variable.loc.column}`,
        });
        combos.push({
          id: `${variable.id}-render`,
          collapsed: true,
          label: { text: "render", fill: "white" },
          combo: variable.id,
          fileName: `${fileName}:${variable.loc.line}:${variable.loc.column}`,
        });

        for (const state of variable.states) {
          nodes.push({
            id: `${variable.id}-state-${state.value}`,
            label: {
              text: state.value,
            },
            // title: `${n.file}\nstate: ${state.value}`,
            combo: variable.id,
            fileName: `${fileName}:${state.loc.line}:${state.loc.column}`,
          });
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
                // title: `${n.file}\nstate: ${state.value}`,
                combo: `${variable.id}-render`,
                fileName: `${fileName}:${render.loc.line}:${render.loc.column}`,
              });
              break;
            }
          }
        }

        for (const v of Object.values(variable.var)) {
          addCombo(v, file, variable.id);
        }
      };

      for (const file of Object.values(graphData.files)) {
        for (const variable of Object.values(file.var)) {
          addCombo(variable, file);
        }
      }

      const edges: EdgeData[] = [];
      for (const e of Object.values(graphData.edges)) {
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
  };

  const graph = useGraph(graphData);

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
  }, [graphData]);

  // initial load
  useEffect(() => {
    loadData();
  }, []);

  // keep stage size responsive
  useEffect(() => {
    const onResize = () =>
      setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // handle global shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
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

  const onSearch = (value: string) => {
    setSearch(value);

    if (value === "") {
      setMatches([]);
      setCurrentMatchIndex(-1);
      resetHighlights();
      return;
    }

    const lowerValue = value.toLowerCase();
    const newMatches: string[] = [];

    const combos = graph.getAllCombos();
    for (const combo of Object.values(combos)) {
      if (combo.label?.text.toLowerCase().includes(lowerValue)) {
        combo.color = "red";
        graph.updateCombo(combo);
        newMatches.push(combo.id);
      } else if (combo.color == "red") {
        combo.color = "blue";
        graph.updateCombo(combo);
      }
    }

    const nodes = graph.getAllNodes();
    for (const node of Object.values(nodes)) {
      if (node.label?.text.toLowerCase().includes(lowerValue)) {
        node.color = "red";
        graph.updateNode(node);
        newMatches.push(node.id);
      } else if (node.color == "red") {
        node.color = "blue";
        graph.updateNode(node);
      }
    }

    setMatches(newMatches);
    if (newMatches.length > 0) {
      setCurrentMatchIndex(0);
      graph.expandAncestors(newMatches[0]);
      graphRef.current?.focusItem(newMatches[0], 1.5); // Zoom in on first match
    } else {
      setCurrentMatchIndex(-1);
    }
  };

  const resetHighlights = () => {
    const combos = graph.getAllCombos();
    for (const combo of Object.values(combos)) {
      if (combo.color === "red") {
        combo.color = "blue";
        graph.updateCombo(combo);
      }
    }
    const nodes = graph.getAllNodes();
    for (const node of Object.values(nodes)) {
      if (node.color === "red") {
        node.color = "blue";
        graph.updateNode(node);
      }
    }
  };

  const goToNextMatch = () => {
    if (matches.length === 0) return;
    const nextIndex = (currentMatchIndex + 1) % matches.length;
    setCurrentMatchIndex(nextIndex);
    graph.expandAncestors(matches[nextIndex]);
    graphRef.current?.focusItem(matches[nextIndex], 1.5);
  };

  const goToPrevMatch = () => {
    if (matches.length === 0) return;
    const prevIndex = (currentMatchIndex - 1 + matches.length) % matches.length;
    setCurrentMatchIndex(prevIndex);
    graph.expandAncestors(matches[prevIndex]);
    graphRef.current?.focusItem(matches[prevIndex], 1.5);
  };

  return (
    <div
      className="w-full h-full relative bg-[#1e1e1e] overflow-hidden"
      style={{ width: "100vw", height: "100vh" }}
    >
      {isSearchOpen && (
        <div className="absolute top-4 right-4 z-50 flex items-center bg-[#2d2d2d] border border-[#454545] rounded shadow-lg p-1 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-1">
            <div className="relative flex items-center">
              <input
                autoFocus
                type="text"
                value={search}
                placeholder="Find"
                onChange={(e) => onSearch(e.target.value)}
                className="bg-[#3c3c3c] text-white pl-2 pr-16 py-1 outline-none text-sm w-64 border border-transparent focus:border-[#007acc] rounded-sm"
              />
              <div className="absolute right-2 text-[11px] text-[#aaaaaa] pointer-events-none">
                {matches.length > 0 ? (
                  <span>
                    {currentMatchIndex + 1} of {matches.length}
                  </span>
                ) : search !== "" ? (
                  <span className="text-[#f48771]">No results</span>
                ) : null}
              </div>
            </div>

            <div className="flex items-center border-l border-[#454545] pl-1 gap-1">
              <button
                onClick={goToPrevMatch}
                className="p-1 hover:bg-[#454545] rounded-sm text-[#cccccc] hover:text-white transition-colors"
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
                className="hover:bg-[#454545] rounded-sm text-[#cccccc] hover:text-white transition-colors"
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
                className="p-1 hover:bg-[#454545] rounded-sm text-[#cccccc] hover:text-white transition-colors ml-1"
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
      <Graph
        ref={graphRef}
        width={size.width}
        height={size.height}
        graph={graph}
      />
    </div>
  );
};

export default CusKonvoTestHook;
