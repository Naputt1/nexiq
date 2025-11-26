import { useEffect, useState } from "react";
import type { JsonData } from "shared";
import useGraph, {
  type ComboData,
  type EdgeData,
  type NodeData,
} from "./graph/hook";
import Graph from "./graph/graph";

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
      const nodes: NodeData[] = [];
      for (const file of Object.values(graphData.files)) {
        for (const n of Object.values(file.var)) {
          if (!n.isComponent) continue;

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

          for (const render of Object.values(n.renders)) {
            nodes.push({
              id: `${n.id}-render-${render}`,
              label: {
                text: render,
              },
              // title: `${n.file}\nstate: ${state.value}`,
              combo: `${n.id}-render`,
            });
          }
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
    const time = performance.now();
    graph.layout();
    console.log("layout", performance.now() - time);
  }, [edges, combos, nodes]);

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
