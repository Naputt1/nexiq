import type Konva from "konva";
import React from "react";
import { Circle } from "react-konva";
import Label, { type LabelData } from "./label";

type PointProps = {
  id: string;
  color?: string;
  x?: number;
  y?: number;
  radius: number;
  onDragMove?: (evt: Konva.KonvaEventObject<DragEvent>) => void;
  label?: LabelData;
};

const Point: React.FC<PointProps> = ({
  id,
  x,
  y,
  color = "red",
  radius = 10,
  onDragMove,
  label,
}) => {
  return (
    <Label
      x={x}
      y={y}
      offsetY={radius + 10}
      onDragMove={onDragMove}
      fill="white"
      {...label}
    >
      <Circle
        id={id}
        radius={radius}
        stroke={color}
        strokeWidth={4}
        fill={color}
        perfectDrawEnabled={false}
      />
    </Label>
  );
};
export default Point;
