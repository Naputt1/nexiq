import { useEffect, useState } from "react";
import type { JsonData } from "shared";
import useGraph, { type ComboData, type EdgeData } from "./graph/hook";
import GraphHook from "./graph/graphHook";

const CusKonvoTestHook = () => {
  const [size, setSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  const [combos, setCombos] = useState<ComboData[]>([]);
  const [edges, setEdges] = useState<EdgeData[]>([]);

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
      }

      const edges: EdgeData[] = [];
      for (const e of Object.values(graphData.edges)) {
        edges.push({
          id: `${e.from}-${e.to}`,
          source: e.from,
          target: e.to,
        });
      }

      setEdges(edges);
      setCombos(combos);
    } catch (err) {
      console.error(err);
    }
  };

  const graph = useGraph({
    edges,
    combos,
  });

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
      <GraphHook width={size.width} height={size.height} graph={graph} />
    </div>
  );
};

export default CusKonvoTestHook;
