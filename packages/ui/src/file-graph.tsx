import { useEffect, useState, useRef } from "react";
import {
  DataSet,
  Network,
  type Node,
  type Edge,
  type Data as NetworkData,
} from "vis-network/standalone";
import type { GraphData } from "shared";

export default function FileGraphViewer() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const networkRef = useRef<Network | null>(null);
  const networkData = useRef<NetworkData | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    (async function loadGraph() {
      try {
        const res = await fetch("./graph.json");
        if (!res.ok) throw new Error("graph.json not found");
        const graph: GraphData = await res.json();

        const nodes = new DataSet(
          Object.values(graph.nodes).map((n) => ({
            id: n.id,
            label: n.name,
            title: `${n.file}\nstates: [${n.states
              .map((v) => `${v.value}`)
              .join(", ")}] `,
            shape: "box",
          })),
        );

        const edges = new DataSet<Edge>(
          graph.edges.map((e) => ({
            from: e.from,
            to: e.to,
            label: e.label,
            arrows: "to",
            smooth: false,
            font: { align: "middle" },
          })),
        );

        networkData.current = { nodes, edges };

        networkRef.current = new Network(
          containerRef.current!,
          { nodes, edges },
          {
            nodes: { shape: "box" },
            edges: { arrows: "to", smooth: false, font: { align: "middle" } },
            interaction: { hover: true, multiselect: false },
            physics: { stabilization: true },
          },
        );
      } catch (err) {
        console.error(err);
        setError("graph.json not found.");
      }
    })();
  }, []);

  // 🔍 Search function
  useEffect(() => {
    const network = networkRef.current;
    if (!network) return;

    // Find node whose label matches the query (case-insensitive)
    const allNodes = networkData.current?.nodes;
    if (!allNodes) return;

    // const allNodes = nodesRef.current.get();

    const matchingNodes: Node[] = [];

    allNodes.forEach((n) => {
      if (n.label?.toLowerCase().includes(query.toLowerCase())) {
        matchingNodes.push(n);
      }
    });

    network.selectNodes(matchingNodes.map((n) => n.id!));
    // networkRef.current.update(
    //   matchingNodes.map((n) => ({ id: n.id, color: { background: "green" } })),
    // );

    // Focus on the node
    // network.focus(node.id, {
    //   scale: 1.2,
    //   animation: { duration: 500, easingFunction: "easeInOutQuad" },
    // });

    // // Select it visually
    // network.selectNodes([node.id]);
  }, [query]);

  if (error) {
    return <h2 style={{ color: "red", textAlign: "center" }}>{error}</h2>;
  }

  return (
    <div style={{ width: "100%", height: "100vh" }}>
      {/* 🔎 Search Bar */}
      <div style={{ padding: "8px", borderBottom: "1px solid #ccc" }}>
        <input
          type="text"
          placeholder="Search node..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            padding: "6px 10px",
            fontSize: "16px",
            width: "200px",
            marginRight: "10px",
          }}
        />
      </div>

      {/* Graph Container */}
      <div
        id="network"
        ref={containerRef}
        style={{ width: "100%", height: "calc(100vh - 44px)" }}
      />
    </div>
  );
}
