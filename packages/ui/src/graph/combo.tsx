import type Konva from "konva";
import React from "react";
import { useEffect, useRef, useState } from "react";
import { Circle } from "react-konva";
import Label, { type LabelData } from "./label";

type ComboProps = {
  id: string;
  collapsed?: boolean;
  color?: string;
  x?: number;
  y?: number;
  radius?: number;
  onDragMove?: (evt: Konva.KonvaEventObject<DragEvent>) => void;
  onCollapse?: () => void;
  onRadiusChange?: (radius: number) => void;
  label?: LabelData;
};

const Combo: React.FC<ComboProps> = ({
  collapsed,
  id,
  x,
  y,
  color = "black",
  radius: minRadius = 10,
  onDragMove,
  onCollapse,
  onRadiusChange,
  label,
}) => {
  const [radius, setRadius] = useState<number>(minRadius);

  const radiusRef = useRef(radius);

  const expanding = useRef(false);

  useEffect(() => {
    radiusRef.current = radius;
  }, [radius]);

  const animateRadius = (target: number, duration = 1000) => {
    const start = radiusRef.current;
    const delta = target - start;
    const startTime = performance.now();

    const step = (now: number) => {
      const t = Math.min((now - startTime) / duration, 1);
      const eased = t * (2 - t);

      setRadius(start + delta * eased);

      if (t < 1) {
        requestAnimationFrame(step);
        return;
      }

      expanding.current = false;
      onRadiusChange?.(radius);
    };

    expanding.current = true;
    requestAnimationFrame(step);
  };

  useEffect(() => {
    const targetRadius = collapsed ? minRadius : minRadius * 2;
    animateRadius(targetRadius);
  }, [collapsed, minRadius]);

  return (
    <Label x={x} y={y} offsetY={radius + 10} onDragMove={onDragMove} {...label}>
      <Circle
        id={id}
        radius={radius}
        stroke={color}
        shadowColor="transparent"
        strokeWidth={4}
        fill={collapsed ? color : "transparent"}
        shadowBlur={10}
        onDblClick={() => {
          if (expanding.current) return;

          onCollapse?.();
        }}
        perfectDrawEnabled={false}
      />
    </Label>
  );
};
export default Combo;
