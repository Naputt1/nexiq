import { useEffect, useRef, useState } from "react";
import {
  Graph,
  type ComboData,
  type EdgeData,
  type GraphData,
  type NodeData,
} from "@antv/g6";
import type { JsonData } from "shared";

export default function FileViewerG6() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [toRender, setToRender] = useState(false);

  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    (async function loadGraph() {
      try {
        const res = await fetch("./graph.json");
        if (!res.ok) throw new Error("graph.json not found");
        const graphData: JsonData = await res.json();
        console.log(graphData);

        const nodes: NodeData[] = [];

        const combos: ComboData[] = [];
        for (const n of Object.values(graphData.files)) {
          nodes.push({
            id: n.path,
            data: {
              label: n.path.replace(
                "/Users/naputt/git/sysits-hr-2024/web/src/",
                ""
              ),
            },
          });
        }

        const edges: EdgeData[] = [];
        for (const n of Object.values(graphData.files)) {
          const source: string[] = [];
          for (const im of Object.values(n.import)) {
            if (!im.source.startsWith("/") || source.includes(im.source))
              continue;
            source.push(im.source);
            edges.push({
              id: `${im.source}-${n.path}`,
              source: im.source,
              target: n.path,
              // label: im.localName,
            });
          }
          console.log(source);
        }

        console.log(nodes, edges, combos);

        const data: GraphData = {
          nodes,
          combos,
          edges,
        };

        if (!containerRef.current) return;

        const graph = new Graph({
          container: "container",
          data: data,
          layout: {
            type: "force",
            workerEnabled: true,
            // comboPadding: 1,
            animation: false,
            // comboPadding: 5, // keeps combo boundaries tight
            nodeSpacing: 2000, // children stay closer
            linkDistance: 200, // edges try to stay short
            preventOverlap: true, // avoids spacing inflation
            // decay: 0.9, // stronger clustering
            // condense: true,

            // innerLayout: new ForceLayout({
            //   gravity: 10000000000000,
            //   factor: 1,
            // }),
          },
          node: {
            style: {
              size: 20,
              labelText: (d) => d.data?.label ?? d.id,
              labelFill: "white",
            },
            palette: {
              type: "group",
              field: (d) => d.combo,
            },
          },
          edge: {
            style: (model) => {
              const { size, color } = model.data;
              return {
                stroke: color || "#BBBBBB",
                lineWidth: size || 1,
              };
            },
          },
          behaviors: [
            "drag-element",
            "drag-canvas",
            "zoom-canvas",
            "collapse-expand",
            "click-select",
          ],
        });

        await graph.render();

        setToRender(true);

        graphRef.current = graph;
      } catch (err) {
        console.error(err);
        setError("graph.json not found");
      }
    })();
  }, []);

  // 🔍 Search highlight & focus
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;

    const keyword = query.toLowerCase();

    graph.getNodeData().forEach((node) => {
      // const model = node.getModel();
      const match =
        node.data!.label && node.data!.label.toLowerCase().includes(keyword);

      // graph.updateItem(node, {
      //   style: {
      //     stroke: match ? "red" : "#999",
      //     lineWidth: match ? 3 : 1,
      //   },
      // });

      if (match) {
        console.log(node.id, match);
        graph.focusElement(node.id, false);
        graph.setElementState(node.id, "selected", false);
      }
    });
  }, [query]);

  if (error) {
    return <h2 style={{ color: "red", textAlign: "center" }}>{error}</h2>;
  }

  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      {/* Search Bar */}
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

      {/* G6 Graph Container */}
      <div
        style={
          {
            // display: toRender ? "block" : "none",
          }
        }
      >
        <div
          ref={containerRef}
          id="container"
          style={{
            width: "100%",
            height: "calc(100vh - 44px)",
          }}
        />
      </div>
    </div>
  );
}
