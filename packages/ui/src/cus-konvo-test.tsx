import { useEffect, useState } from "react";
import Graph, { type ComboData } from "./graph/graph";
import type { JsonData } from "shared";

const CusKonvoTest = () => {
  const [size, setSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  const [combos, setCombos] = useState<ComboData[]>([]);

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

      setCombos(combos);
    } catch (err) {
      console.error(err);
    }
  };

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
      <Graph width={size.width} height={size.height} combos={combos} />
    </div>
  );
};

export default CusKonvoTest;
