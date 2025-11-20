import { Arrow, Layer } from "react-konva";
import Combo from "./combo";
import { memo, useCallback, useEffect, useReducer, type JSX } from "react";
import DragableStage from "./dragableGraph";
import type {
  ComboGraphData,
  EdgeGraphData,
  GraphData,
  GraphDataCallbackParams,
  NodeGraphData,
} from "./hook";

type GraphProps = {
  graph: GraphData;
  width?: number;
  height?: number;
};

type DataMap = {
  nodes: Record<string, NodeGraphData>;
  edges: Record<string, JSX.Element>;
  combos: Record<string, JSX.Element>;
};

const MemoizedCombo = memo(Combo);
const MemoizedArrow = memo(Arrow);

const GraphHook: React.FC<GraphProps> = ({ graph, width, height }) => {
  const getComboElement = useCallback(
    (data: ComboGraphData) => {
      return (
        <MemoizedCombo
          key={data.id}
          id={data.id}
          x={data.x}
          y={data.y}
          color={"blue"}
          radius={data.radius}
          collapsedRadius={data.collapsedRadius}
          expandedRadius={data.expandedRadius}
          collapsed={data.collapsed}
          onCollapse={() => graph.comboCollapsed(data.id)}
          onDragMove={(e) => graph.comboDragMove(data.id, e)}
          onRadiusChange={(radius) => graph.comboRadiusChange(data.id, radius)}
          label={data.label}
        />
      );
    },
    [graph]
  );

  const getEdgeElement = useCallback(
    (data: EdgeGraphData) => {
      return (
        <MemoizedArrow
          key={data.id}
          id={data.id}
          points={data.points}
          stroke={"white"}
          strokeWidth={4}
          lineJoin="round"
          perfectDrawEnabled={false}
          // draggable
        />
      );
    },
    [graph]
  );

  const [dataMap, dispatch] = useReducer(
    (state, action: GraphDataCallbackParams) => {
      switch (action.type) {
        case "new-nodes":
          return {
            ...state,
            nodes: graph.getNodes(),
          };
        case "new-edges": {
          const edgesData = graph.getEdges();
          const edges: Record<string, JSX.Element> = {};
          for (const e of Object.values(edgesData)) {
            edges[e.id] = getEdgeElement(e);
          }
          return {
            ...state,
            edges,
          };
        }
        case "new-combos": {
          const combosData = graph.getCombos();
          const combos: Record<string, JSX.Element> = {};
          for (const c of Object.values(combosData)) {
            combos[c.id] = getComboElement(c);
          }
          return {
            ...state,
            combos,
          };
        }
        case "combo-collapsed": {
          const newCombos: Record<string, JSX.Element> = { ...state.combos };
          const combo = graph.getCombo(action.id);
          if (combo != null) {
            newCombos[action.id] = getComboElement(combo);
          }

          return {
            ...state,
            combos: newCombos,
          };
        }
        case "combo-drag-move": {
          const edges = { ...state.edges };
          for (const id of action.edgeIds) {
            const edge = graph.getEdge(id);
            if (edge != null) {
              edges[id] = getEdgeElement(edge);
            }
          }

          return {
            ...state,
            edges,
            // combos: newCombos,
          };
        }
        case "combo-radius-change": {
          const combos = { ...state.combos };
          const combo = graph.getCombo(action.id);
          if (combo != null) {
            combos[action.id] = getComboElement(combo);
          }

          const edges = { ...state.edges };
          for (const id of action.edgeIds) {
            const edge = graph.getEdge(id);
            if (edge != null) {
              edges[id] = getEdgeElement(edge);
            }
          }

          return {
            ...state,
            edges,
            combos,
          };
        }
      }
    },
    {
      nodes: {},
      edges: {},
      combos: {},
    } as DataMap
  );

  useEffect(() => {
    dispatch({ type: "new-nodes" });
    dispatch({ type: "new-edges" });
    dispatch({ type: "new-combos" });

    const id = graph.bind(dispatch);

    return () => {
      graph.unbind(id);
    };
  }, []);

  return (
    <DragableStage width={width} height={height}>
      <Layer>{...Object.values(dataMap?.edges)}</Layer>
      <Layer>{...Object.values(dataMap?.combos)}</Layer>
    </DragableStage>
  );
};

export default GraphHook;
