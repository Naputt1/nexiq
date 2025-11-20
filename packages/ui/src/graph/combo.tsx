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
  radius: number;
  collapsedRadius: number;
  expandedRadius: number;
  onDragMove?: (evt: Konva.KonvaEventObject<DragEvent>) => void;
  onCollapse?: () => void;
  onRadiusChange?: (radius: number) => void;
  label?: LabelData;
  animation?: boolean;
};

const Combo: React.FC<ComboProps> = ({
  collapsed,
  id,
  x,
  y,
  color = "black",
  radius: _radius = 10,
  collapsedRadius = 20,
  expandedRadius = 40,
  onDragMove,
  onCollapse,
  onRadiusChange,
  label,
  animation,
}) => {
  const [radius, setRadius] = useState<number>(_radius);

  const radiusRef = useRef(radius);

  const expanding = useRef(false);

  useEffect(() => {
    radiusRef.current = radius;
  }, [radius]);

  useEffect(() => {
    setRadius(_radius);
  }, [_radius]);

  const animateRadius = (target: number, duration = 1000) => {
    const start = radiusRef.current;
    const delta = target - start;
    const startTime = performance.now();

    const step = (now: number) => {
      const t = Math.min((now - startTime) / duration, 1);
      const eased = t * (2 - t);

      setRadius(start + delta * eased);
      onRadiusChange?.(start + delta * eased);

      if (t < 1) {
        requestAnimationFrame(step);
        return;
      }

      expanding.current = false;
      // onRadiusChange?.(radius);
    };

    expanding.current = true;
    requestAnimationFrame(step);
  };

  useEffect(() => {
    const targetRadius = collapsed ? collapsedRadius : expandedRadius;
    if (animation == false) {
      onRadiusChange?.(targetRadius);
      return;
    }
    animateRadius(targetRadius);
  }, [collapsed, collapsedRadius]);

  const dblClickLock = useRef(false);

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
          if (dblClickLock.current) return;

          dblClickLock.current = true;
          setTimeout(() => (dblClickLock.current = false), 200);

          onCollapse?.();
        }}
        perfectDrawEnabled={false}
      />
    </Label>
  );
};
export default Combo;
