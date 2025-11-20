import { Layer } from "react-konva";
import Combo from "./combo";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { LabelData } from "./label";
import DragableStage from "./dragableGraph";
import type {
  ComboData,
  ComboGraphData,
  EdgeData,
  GraphItem,
  NodeData,
} from "./hook";

type GraphProps = {
  nodes?: NodeData[];
  edges?: EdgeData[];
  combos?: ComboData[];
  width?: number;
  height?: number;
};

const MemoizedCombo = memo(Combo);

const Graph: React.FC<GraphProps> = ({
  nodes,
  edges,
  combos: combosData = [],
  width,
  height,
}) => {
  const [combosMap, setCombosMap] = useState<Record<string, ComboGraphData>>(
    {}
  );
  const combos = useMemo(() => Object.values(combosMap), [combosMap]);

  useEffect(() => {
    const combos: Record<string, ComboGraphData> = {};
    for (const c of combosData) {
      combos[c.id] = {
        ...c,
        x: Math.random() * combosData.length * 20,
        y: Math.random() * combosData.length * 20,
      };
    }

    setCombosMap(combos);
  }, [combosData]);

  const setCollapse = useCallback((id: string, collapsed: boolean) => {
    setCombosMap((c) => {
      const newCombo = { ...c };
      newCombo[id].collapsed = collapsed;
      return newCombo;
    });
  }, []);

  return (
    <DragableStage width={width} height={height}>
      <Layer>
        {combos.map((combo) => {
          return (
            <MemoizedCombo
              key={combo.id}
              x={combo.x}
              y={combo.y}
              color={"blue"}
              radius={20}
              collapsed={combo.collapsed}
              onCollapse={() => setCollapse(combo.id, !combo.collapsed)}
              label={combo.label}
            />
          );
        })}
      </Layer>
    </DragableStage>
  );
};

export default Graph;
