import type Konva from "konva";
import React, { memo } from "react";
import { useEffect, useRef, useState } from "react";
import { Circle, Group } from "react-konva";
import Label from "./label";
import type { GraphData } from "./hook";
import Point from "./point";

type ComboProps = {
  id: string;
  onDragMove?: (id: string, evt: Konva.KonvaEventObject<DragEvent>) => void;
  graph: GraphData;
};

const Combo: React.FC<ComboProps> = memo(({ id, graph, onDragMove }) => {
  const {
    radius: _radius = 20,
    collapsed,
    collapsedRadius = 20,
    expandedRadius = 40,
    animation,
    x,
    y,
    label,
    color,
    nodes = {},
    combos = [],
    fileName,
    comboCollapsed,
    comboDragMove,
    comboRadiusChange,
    comboHover,
  } = graph.useCombo(id);

  const [radius, setRadius] = useState<number>(
    collapsed ? collapsedRadius : expandedRadius
  );

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
      comboRadiusChange?.(id, start + delta * eased);

      if (t < 1) {
        requestAnimationFrame(step);
        return;
      }

      expanding.current = false;
    };

    expanding.current = true;
    requestAnimationFrame(step);
  };

  useEffect(() => {
    const targetRadius = collapsed ? collapsedRadius : expandedRadius;
    if (radius == targetRadius) return;

    if (animation == false) {
      comboRadiusChange?.(id, targetRadius);
      return;
    }
    animateRadius(targetRadius);
  }, [collapsed, collapsedRadius]);

  const dblClickLock = useRef(false);

  return (
    <Label
      x={x}
      y={y}
      offsetY={radius + 10}
      onDragMove={(e) => {
        comboDragMove?.(id, e);
        onDragMove?.(id, e);
      }}
      onClick={(e) => {
        if (e.evt.ctrlKey) {
          e.cancelBubble = true;
          window.ipcRenderer.invoke("open-vscode", fileName);
        }
      }}
      {...label}
    >
      <Group
        clipFunc={
          radius != expandedRadius
            ? (ctx) => {
                ctx.beginPath();
                ctx.arc(0, 0, radius, 0, Math.PI * 2, false);
                ctx.closePath();
              }
            : undefined
        }
        perfectDrawEnabled={false}
      >
        <Circle
          id={id}
          radius={radius}
          stroke={color}
          // shadowColor="transparent"
          strokeWidth={4}
          fill={collapsed ? color : "transparent"}
          // shadowBlur={10}
          onMouseEnter={comboHover}
          onDblClick={(e) => {
            e.cancelBubble = true;
            if (expanding.current) return;
            if (dblClickLock.current) return;

            dblClickLock.current = true;
            setTimeout(() => (dblClickLock.current = false), 200);

            comboCollapsed?.(id);
          }}
          perfectDrawEnabled={false}
        />
        {!collapsed && (
          <>
            {...Object.values(nodes).map((node) => (
              <Point
                key={node.id}
                id={node.id}
                x={node.x}
                y={node.y}
                onDragMove={(e) => {
                  e.cancelBubble = true;
                  graph.comboChildNodeMove(id, node.id, e);
                }}
                onClick={(e) => {
                  if (e.evt.ctrlKey) {
                    e.cancelBubble = true;
                    window.ipcRenderer.invoke("open-vscode", node.fileName);
                  }
                }}
                radius={node.radius}
                label={node.label}
              />
            ))}
            {...combos?.map((id) => (
              <Combo
                key={id}
                id={id}
                graph={graph}
                onDragMove={(_id, e) => {
                  e.cancelBubble = true;
                }}
              />
            ))}

            {/* TODO: add edges */}
          </>
        )}
      </Group>
    </Label>
  );
});

export default Combo;
