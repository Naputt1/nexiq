import { useEffect, useRef, useState } from "react";
import {
  Circle,
  CircleCombo,
  ConcentricLayout,
  ExtensionCategory,
  ForceLayout,
  Graph,
  register,
  type CircleComboStyleProps,
  type ComboData,
  type GraphData,
  type IconStyleProps,
  type NodeData,
  type NodeLikeData,
} from "@antv/g6";
import type { JsonData } from "shared";
import type { CircleStyleProps, DisplayObjectConfig } from "@antv/g-lite";

class CustomCircleCombo extends CircleCombo {
  constructor(options: DisplayObjectConfig<CircleStyleProps>) {
    super(options);
  }

  protected getCollapsedMarkerStyle(): IconStyleProps | false {
    return false; // ← NO marker, NO child count
  }

  protected drawCollapsedMarkerShape() {
    return; // do nothing
  }
}

register(ExtensionCategory.COMBO, "custom-combo", CustomCircleCombo);

export default function FileGraphViewerG6() {
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

        const edges = new Set();
        const nodes: NodeData[] = [{ id: "0" }];

        // Object.values(graphData.nodes).map((n) => {
        //   for (const state of n.states) {
        //     nodes.push({
        //       id: `${n.id}-state-${state.value}`,
        //       label: state.value,
        //       title: `${n.file}\nstate: ${state.value}`,
        //       combo: n.id,
        //       style: {
        //         size: 10,
        //       },
        //     });
        //   }
        // });

        const combos: ComboData[] = [];
        const ids = new Set<string>();

        for (const file of Object.values(graphData.files)) {
          for (const n of Object.values(file.var)) {
            if (!n.isComponent) continue;
            const fileName = graphData.src + file.path;

            ids.add(n.id);
            combos.push({
              id: n.id,
              collapsed: true,
              data: { label: n.name, fill: "white" },
              fileName,
            });
            combos.push({
              id: `${n.id}-render`,
              collapsed: true,
              data: { label: "render", fill: "white" },
              combo: n.id,
              fileName,
            });
          }
        }

        // for (const n of Object.values(graphData.nodes)) {
        //   const x = Math.random() * 100;
        //   const y = Math.random() * 100;
        //   combos.push({
        //     id: n.id,
        //     data: { label: n.name, length: n.states.length },
        //     style: {
        //       // ...(n.states.length > 0 ? { collapsed: true } : {}),
        //       x,
        //       y,
        //     },
        //   });
        //   // combos.push({
        //   //   id: `${n.id}-render`,
        //   //   data: { label: "render", length: n.states.length },
        //   //   combo: n.id,
        //   //   style: {
        //   //     collapsed: true,
        //   //     x,
        //   //     y,
        //   //   },
        //   // });
        // }

        const data: GraphData = {
          nodes,
          combos,
          edges: graphData.edges
            .filter((e) => {
              if (edges.has(e.from + e.to)) return false;

              if (edges.has(e.from + e.to)) return false;

              edges.add(e.from + e.to);

              return ids.has(e.from) && ids.has(e.to);
            })
            .map((e) => ({
              source: String(e.from),
              target: String(e.to),
              label: e.label,
              style: {
                endArrow: true, // <-- simple arrow
                lineWidth: 2, // optional, makes edge thicker
              },
            })),
        };

        // data.combos.forEach((combo) => {
        //   const children = data.nodes.filter((node) => node.combo === combo.id);
        //   if (children.length === 0) {
        //     data.nodes.push({
        //       id: `${combo.id}-dummy`,
        //       combo: combo.id,
        //       label: "", // hide label
        //       size: 0, // zero size
        //       style: { opacity: 0 },
        //       x: combo.x || 0,
        //       y: combo.y || 0,
        //     });
        //   }
        // });

        // data.combos.forEach((combo, index) => {
        //   const hasChildren = data.nodes.some(
        //     (node) => node.combo === combo.id
        //   );
        //   if (!hasChildren) {
        //     combo.x = 50 + index * 100;
        //     combo.y = 50;
        //   }
        // });

        if (!containerRef.current) return;

        const data2 = await fetch(
          "https://assets.antv.antgroup.com/g6/combo.json"
        ).then((res) => res.json());

        console.log(data, data2);

        // const graph = new Graph({
        //   container: containerRef.current,
        //   width: containerRef.current.clientWidth,
        //   height: containerRef.current.clientHeight,
        //   layout: {
        //     type: "combo-combined",
        //     preventOverlap: true,
        //     animation: false,
        //     nodeSpacing: 0,
        //     comboPadding: 100,
        //     updateCenter: false,
        //     innerLayout: new ConcentricLayout({
        //       sortBy: "id",
        //       nodeSize: 20,
        //       clockwise: true,
        //     }),

        //     outerLayout: new ForceLayout({
        //       gravity: 1,
        //       factor: 2,
        //       linkDistance: (edge: any, source: any, target: any) => {
        //         const nodeSize =
        //           ((source.size?.[0] || 30) + (target.size?.[0] || 30)) / 2;
        //         return Math.min(nodeSize * 1.5, 70);
        //       },
        //     }),
        //   },
        //   data,
        //   node: {
        //     style: {
        //       labelText: (datum) => `${datum.label}`,
        //       size: 20,
        //       labelFill: "white",
        //     },
        //     palette: {
        //       type: "group",
        //       field: (d) => `${d.combo}`,
        //     },
        //   },
        //   combo: {
        //     type: "circle",
        //     style: {
        //       // padding: 2,
        //       labelText: (d) => `${d.label}`,
        //       labelFill: "white",
        //       labelPlacement: "top",
        //     },
        //   },
        //   behaviors: [
        //     "drag-canvas",
        //     "zoom-canvas",
        //     "scroll-canvas",
        //     // "optimize-viewport-transform",
        //     "click-select",
        //     "brush-select",
        //     "drag-element",
        //     "hover-activate",
        //     "auto-adapt-label",
        //     "collapse-expand",
        //   ],
        //   autoResize: true,
        // });

        // data.nodes = [...data.nodes, ...data2.nodes];
        // data.combos = [...data.combos, ...data2.combos];
        // data.edges = [...data.edges, ...data2.edges];

        // data.nodes = data2.nodes;
        // data.combos = data2.combos;
        // data.edges = data2.edges;

        console.log(data);

        const graph = new Graph({
          container: "container",
          data: data,
          layout: {
            type: "combo-combined",
            workerEnabled: true,
            comboPadding: 1,
            animation: false,
            // comboPadding: 5, // keeps combo boundaries tight
            nodeSpacing: 1, // children stay closer
            linkDistance: 20, // edges try to stay short
            preventOverlap: true, // avoids spacing inflation
            decay: 0.9, // stronger clustering
            condense: true,

            // innerLayout: new ForceLayout({
            //   gravity: 10000000000000,
            //   factor: 1,
            // }),
          },
          node: {
            style: {
              size: 20,
              labelText: (d) => d.label ?? d.id,
              labelFill: "white",
            },
            palette: {
              type: "group",
              field: (d) => d.combo,
            },
          },
          combo: {
            style: {
              // type: "custom-combo",
              labelText: (d) => `${d.data!.label}`,
              labelFill: "white",
              collapsedMarker: true,
              // collapsedMarkerType: (children: NodeLikeData[]): string => {
              //   console.log(children);
              //   return `${children.data.length}`;
              // },
              collapsedMarkerType: "descendant-count",
            },
          },
          edge: {
            style: (model) => {
              const { size, color } = model.data;
              return {
                stroke: color || "#FFFFFF",
                lineWidth: size || 1,
              };
            },
          },
          behaviors: [
            "drag-element",
            "drag-canvas",
            "zoom-canvas",
            "collapse-expand",
          ],
        });

        // graph.on("afterrender", () => {
        //   graph
        //     .getComboData()
        //     ?.forEach((combo) => graph.collapseElement(combo?.id));
        // });

        // graph.layout();

        // graph.updateComboData((prev) => {
        //   for (const combo of prev) {
        //     if (combo.style == null) {
        //       combo.style = {};
        //     }
        //     combo.style.collapsed = true;
        //   }
        //   return prev;
        // });

        // graph.data(data);

        // graph.clear();
        await graph.render();
        // for (const combo of data.combos) {
        //   await graph.collapseElement(combo.id, false);
        // }

        // for (const n of Object.values(graphData.nodes)) {
        //   // const x = Math.random() * 100;
        //   // const y = Math.random() * 100;
        //   // combos.push({
        //   //   id: n.id,
        //   //   data: { label: n.name, length: n.states.length },
        //   //   style: {
        //   //     // ...(n.states.length > 0 ? { collapsed: true } : {}),
        //   //     x,
        //   //     y,
        //   //   },
        //   // });
        //   graph.get;
        //   graph.addComboData([
        //     {
        //       id: `${n.id}-render`,
        //       data: { label: "render", length: n.states.length },
        //       combo: n.id,
        //       style: {
        //         collapsed: true,
        //         // x,
        //         // y,
        //       },
        //     },
        //   ]);
        // }

        // graph.getComboData().forEach((combo) => {
        //   graph.addComboData([
        //     {
        //       id: `${combo.id}-render`,
        //       data: { label: "render" },
        //       combo: combo.id,
        //       style: {
        //         collapsed: true,
        //         x: combo.style?.x,
        //         y: combo.style?.y + 100,
        //       },
        //     },
        //   ]);
        // });

        // Object.values(graphData.nodes).map((n) => {
        //   for (const state of n.states) {
        //     graph.addNodeData([
        //       {
        //         id: `${n.id}-state-${state.value}`,
        //         label: state.value,
        //         title: `${n.file}\nstate: ${state.value}`,
        //         combo: n.id,
        //         style: {
        //           size: 10,
        //         },
        //       },
        //     ]);
        //     // nodes.push({
        //     //   id: `${n.id}-state-${state.value}`,
        //     //   label: state.value,
        //     //   title: `${n.file}\nstate: ${state.value}`,
        //     //   combo: n.id,
        //     //   style: {
        //     //     size: 10,
        //     //   },
        //     // });
        //   }
        // });

        // await graph.layout();

        // graph
        //   .getComboData()
        //   ?.forEach((combo) => graph.collapseElement(combo?.id));

        // const removeNodes = data.nodes
        //   .filter((node) => node.id.endsWith("-dummy"))
        //   .map((node) => node.id);
        // console.log(removeNodes);
        // graph.removeNodeData(removeNodes);

        setToRender(true);

        // graph.updateComboData((prev) => {
        //   for (const combo of prev) {
        //     if (combo.style == null) {
        //       combo.style = {};
        //     }
        //     combo.style.collapsed = true;
        //   }
        //   return prev;
        // });

        graphRef.current = graph;
      } catch (err) {
        console.error(err);
        setError(err.message);
      }
    })();
  }, []);

  // 🔍 Search highlight & focus
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;

    const keyword = query.toLowerCase();

    graph.getNodes().forEach((node) => {
      const model = node.getModel();
      const match = model.label && model.label.toLowerCase().includes(keyword);

      graph.updateItem(node, {
        style: {
          stroke: match ? "red" : "#999",
          lineWidth: match ? 3 : 1,
        },
      });

      if (match) {
        graph.focusItem(node, true, {
          easing: "easeCubic",
          duration: 300,
        });
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
