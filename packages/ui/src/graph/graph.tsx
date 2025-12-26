import { Arrow, Layer } from "react-konva";
import Combo from "./combo";
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useReducer,
  useRef,
  useState,
  type JSX,
} from "react";
import DragableStage, { type DragableStageRef } from "./dragableGraph";
import type {
  ComboGraphData,
  EdgeGraphData,
  GraphData,
  GraphDataCallbackParams,
  NodeGraphData,
} from "./hook";
import type { Vector2d } from "konva/lib/types";

export interface GraphRef {
  focusItem: (id: string, scale?: number) => void;
}

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

type GraphState = {
  x: number;
  y: number;
  scale: Vector2d;
};

const MemoizedArrow = memo(Arrow);

const Graph = forwardRef<GraphRef, GraphProps>(({ graph, width, height }, ref) => {
  const stageRef = useRef<DragableStageRef>(null);
  const [state, setState] = useState<GraphState>({
    x: 0,
    y: 0,
    scale: {
      x: 1,
      y: 1,
    },
  });

  useImperativeHandle(ref, () => ({
    focusItem: (id: string, scale?: number) => {
      const pos = graph.getAbsolutePosition(id);
      if (pos) {
        stageRef.current?.focusOn(pos.x, pos.y, scale);
      }
    },
  }));

  const getComboElement = useCallback(
    (combo: ComboGraphData) => {
      return <Combo key={combo.id} id={combo.id} graph={graph} />;
    },
    [graph]
  );

  const getEdgeElement = useCallback(
    (edge: EdgeGraphData) => {
      return (
        <MemoizedArrow
          key={edge.id}
          id={edge.id}
          points={edge.points}
          fill={"#424242"}
          stroke={"#666666"}
          strokeWidth={0.5}
          lineJoin="round"
          perfectDrawEnabled={false}
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
            nodes: graph.getCurNodes(),
          };
        case "new-edges": {
          const edgesData = graph.getCurEdges();
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
          const combosData = graph.getCurCombos();
          const combos: Record<string, JSX.Element> = {};
          for (const c of Object.values(combosData)) {
            combos[c.id] = getComboElement(c);
          }
          return {
            ...state,
            combos,
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
    const id = graph.bind(dispatch);

    return () => {
      graph.unbind(id);
    };
  }, []);

  return (
    <DragableStage
      ref={stageRef}
      width={width}
      height={height}
    >
      <Layer>{...Object.values(dataMap?.edges)}</Layer>
      <Layer>{...Object.values(dataMap?.combos)}</Layer>
    </DragableStage>
  );
});

Graph.displayName = "Graph";

export default Graph;
