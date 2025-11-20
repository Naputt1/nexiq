import { useEffect, useState, useRef } from "react";
import { DataSet, Network, type Edge } from "vis-network/standalone";
import type { JsonData } from "shared";

export default function GraphViewer() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async function loadGraph() {
      try {
        const res = await fetch("./graph.json");
        if (!res.ok) throw new Error("graph.json not found");
        const graph: JsonData = await res.json();
        console.log(graph);

        const nodes = new DataSet(
          Object.values(graph.nodes).map((n) => {
            return {
              id: n.id,
              label: n.name,
              title: `${n.file}\nstates: [${n.states
                .map((v) => `${v.value}`)
                .join(", ")}] `,
              shape: "box",
            };
          })
        );

        const edges = new DataSet<Edge>(
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
          containerRef.current!,
          { nodes, edges },
          {
            nodes: { shape: "box" },
            edges: { arrows: "to", smooth: false, font: { align: "middle" } },
            interaction: { hover: true, multiselect: false },
            physics: { stabilization: true },
          }
        );
      } catch (err) {
        console.error(err);
        setError("graph.json not found.");
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
