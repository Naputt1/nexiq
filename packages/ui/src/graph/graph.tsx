import { Arrow, Layer } from "react-konva";
import Combo from "./combo";
import {
  memo,
  useCallback,
  useEffect,
  useReducer,
  useState,
  type JSX,
} from "react";
import DragableStage from "./dragableGraph";
import type {
  ComboGraphData,
  EdgeGraphData,
  GraphData,
  GraphDataCallbackParams,
  NodeGraphData,
} from "./hook";
import type { Vector2d } from "konva/lib/types";

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

const Graph: React.FC<GraphProps> = ({ graph, width, height }) => {
  const [state, setState] = useState<GraphState>({
    x: 0,
    y: 0,
    scale: {
      x: 1,
      y: 1,
    },
  });

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
          stroke={"white"}
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
        // case "combo-collapsed": {
        //   const newCombos: Record<string, JSX.Element> = { ...state.combos };
        //   const combo = graph.getCombo(action.id);
        //   if (combo != null) {
        //     newCombos[action.id] = getComboElement(combo);
        //   }

        //   return {
        //     ...state,
        //     combos: newCombos,
        //   };
        // }
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
    // graph.layout();

    return () => {
      graph.unbind(id);
    };
  }, []);

  return (
    <DragableStage
      width={width}
      height={height}
      // onDragMove={(e) => {
      //   const stage = e.target;
      //   graph.setPosition(stage.x(), stage.y());
      //   setState((s) => {
      //     return {
      //       ...s,
      //       x: stage.x(),
      //       y: stage.y(),
      //     };
      //   });
      // }}
      // onWheel={(e) => {
      //   const scaleBy = 1.05;
      //   const stage = e.target;

      //   const oldScale = stage.scaleX();
      //   const newScale =
      //     e.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy;

      //   // const stage = e.target;
      //   graph.setScale(stage.scale().x);
      //   stage.getAbsoluteScale();

      //   console.log(stage.scale(), stage.getAbsoluteScale());
      //   setState((s) => {
      //     return {
      //       ...s,
      //       scale: {
      //         x: newScale,
      //         y: newScale,
      //       },
      //     };
      //   });
      // }}
      // x={state.x}
      // y={state.y}
      // scale={state.scale}
    >
      <Layer>{...Object.values(dataMap?.edges)}</Layer>
      <Layer>{...Object.values(dataMap?.combos)}</Layer>
    </DragableStage>
  );
};

export default Graph;
