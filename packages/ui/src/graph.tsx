import { useEffect, useState, useRef } from "react";
import { DataSet, Network } from "vis-network/standalone";

export default function GraphViewer() {
  const containerRef = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async function loadGraph() {
      try {
        const res = await fetch("./graph.json");
        if (!res.ok) throw new Error("graph.json not found");
        const graph = await res.json();

        const nodes = new DataSet(
          Object.values(graph.nodes).map((n) => ({
            id: n.id,
            label: n.name,
            title: `${n.file}\nstates:${n.states}`,
            shape: "box",
          }))
        );

        const edges = new DataSet(
          graph.edges.map((e) => ({
            from: e.from,
            to: e.to,
            label: e.label,
            arrows: "to",
            smooth: false,
            font: { align: "middle" },
          }))
        );

        const network = new Network(
          containerRef.current,
          { nodes, edges },
          {
            nodes: { shape: "box" },
            edges: { arrows: "to", smooth: false, font: { align: "middle" } },
            interaction: { hover: true, multiselect: false },
            physics: { stabilization: true },
          }
        );

        // Optional: log for debugging
        console.log("Graph loaded", graph);
      } catch (err) {
        console.error(err);
        setError(
          "graph.json not found. Run analyzer and place out/graph.json at project root."
        );
      }
    })();
  }, []);

  if (error) {
    return <h2 style={{ color: "red", textAlign: "center" }}>{error}</h2>;
  }

  return (
    <div
      id="network"
      ref={containerRef}
      style={{ width: "100%", height: "100vh", border: "1px solid #ccc" }}
    />
  );
}
