import { useEffect, useState } from "react";
import type { JsonData } from "shared";
import useGraph, {
  type ComboData,
  type EdgeData,
  type NodeData,
} from "./graph/hook";
import Graph from "./graph/graph";
import { ForceLayout, type Edge, type Node } from "./graph/layout";

const CusKonvoTestHook = () => {
  const [size, setSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  const [combos, setCombos] = useState<ComboData[]>([]);
  const [edges, setEdges] = useState<EdgeData[]>([]);
  const [nodes, setNodes] = useState<NodeData[]>([]);

  const loadData = async () => {
    try {
      const res = await fetch("/public/graph.json");
      if (!res.ok) throw new Error("graph.json not found");
      const graphData: JsonData = await res.json();

      const combos: ComboData[] = [];
      for (const n of Object.values(graphData.nodes)) {
        combos.push({
          id: n.id,
          collapsed: true,
          label: { text: n.name, fill: "white" },
        });
        combos.push({
          id: `${n.id}-render`,
          collapsed: true,
          label: { text: "render", fill: "white" },
          combo: n.id,
        });
      }

      const edges: EdgeData[] = [];
      for (const e of Object.values(graphData.edges)) {
        edges.push({
          id: `${e.from}-${e.to}`,
          source: e.from,
          target: e.to,
        });
      }

      const nodes: NodeData[] = [];
      Object.values(graphData.nodes).map((n) => {
        for (const state of n.states) {
          nodes.push({
            id: `${n.id}-state-${state.value}`,
            label: {
              text: state.value,
            },
            // title: `${n.file}\nstate: ${state.value}`,
            combo: n.id,
          });
        }

        for (const render of n.renders) {
          nodes.push({
            id: `${n.id}-render-${render}`,
            label: {
              text: render,
            },
            // title: `${n.file}\nstate: ${state.value}`,
            combo: `${n.id}-render`,
          });
        }
      });

      setNodes(nodes);
      setEdges(edges);
      setCombos(combos);
    } catch (err) {
      console.error(err);
    }
  };

  const graph = useGraph({
    edges,
    combos,
    nodes,
  });

  useEffect(() => {
    if (edges.length == 0 || combos.length == 0 || nodes.length == 0) return;
    graph.layout();
  }, [edges, combos, nodes]);

  useEffect(() => {
    const nodes: Node[] = [
      { id: "a", x: -100, y: 0 },
      { id: "b", x: 100, y: 0 },
      { id: "c", x: 0, y: 100 },
      { id: "d", x: 0, y: -100 },
    ];

    const edges: Edge[] = [
      { source: "a", target: "b", distance: 200, strength: 0.05 },
      { source: "a", target: "c" },
      { source: "b", target: "d" },
    ];

    const layout = new ForceLayout(nodes, edges, {
      repulsionStrength: 400,
      linkDistance: 120,
      damping: 0.85,
      gravity: 0.05,
      timeStep: 0.02,
    });

    // layout.onTick = (nodesPositions, step) => {
    //   // render your nodesPositions into canvas/SVG/DOM
    //   console.log("tick", step, nodesPositions);
    // };

    // run synchronously 200 steps (for Node or to precompute)
    layout.runSteps(200);

    console.log("layout", layout);
  }, []);

  // keep stage size responsive
  useEffect(() => {
    loadData();
    const onResize = () =>
      setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <div className="w-full h-full" style={{ width: "100vw", height: "100vh" }}>
      <Graph width={size.width} height={size.height} graph={graph} />
    </div>
  );
};

export default CusKonvoTestHook;
