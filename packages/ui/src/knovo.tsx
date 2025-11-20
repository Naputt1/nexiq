import { useEffect, useRef, useState } from "react";
import {
  Graph,
  type ComboData,
  type EdgeData,
  type GraphData,
  type NodeData,
} from "@antv/g6";
import type { JsonData } from "shared";
import { Arrow, Circle, Layer, Rect, Stage, Text } from "react-konva";
import React from "react";
import Combo from "./graph/combo";

export default function FileKonvo() {
  const stageRef = useRef(null);
  const [size, setSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const [isDragging, setIsDragging] = useState(false);

  // keep stage size responsive
  useEffect(() => {
    const onResize = () =>
      setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // helper to set cursor on the stage container
  const setStageCursor = (cursor) => {
    const container = stageRef.current && stageRef.current.container();
    if (container) container.style.cursor = cursor;
  };

  // optional: simple wheel-to-zoom centered on pointer
  const handleWheel = (e) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;

    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();
    const scaleBy = 1.02;
    const direction = e.evt.deltaY > 0 ? 1 : -1;
    const newScale = direction > 0 ? oldScale / scaleBy : oldScale * scaleBy;

    // limit zoom
    const clamped = Math.max(0.2, Math.min(5, newScale));

    // compute new position to zoom to pointer
    const mouseTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };

    const newPos = {
      x: pointer.x - mouseTo.x * clamped,
      y: pointer.y - mouseTo.y * clamped,
    };

    stage.scale({ x: clamped, y: clamped });
    stage.position(newPos);
    stage.batchDraw();
  };

  const generateTargets = () => {
    const number = 10;
    const result = [];
    while (result.length < number) {
      result.push({
        id: "target-" + result.length,
        x: window.innerWidth * Math.random(),
        y: window.innerHeight * Math.random(),
        radius: 20 + Math.random() * 20,
        fill: "#" + Math.floor(Math.random() * 16777215).toString(16),
      });
    }
    return result;
  };

  const generateConnectors = (targets) => {
    const number = 10;
    const result = [];
    while (result.length < number) {
      const from = "target-" + Math.floor(Math.random() * targets.length);
      const to = "target-" + Math.floor(Math.random() * targets.length);
      if (from === to) {
        continue;
      }
      result.push({
        id: "connector-" + result.length,
        from,
        to,
      });
    }
    return result;
  };

  const [targets, setTargets] = useState([]);
  const [connectors, setConnectors] = useState([]);

  useEffect(() => {
    const initialTargets = generateTargets();
    setTargets(initialTargets);
    setConnectors(generateConnectors(initialTargets));
  }, []);

  const getConnectorPoints = (from, to) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const angle = Math.atan2(-dy, dx);

    const radius = 40;

    return [
      from.x + -radius * Math.cos(angle + Math.PI),
      from.y + radius * Math.sin(angle + Math.PI),
      to.x + -radius * Math.cos(angle),
      to.y + radius * Math.sin(angle),
    ];
  };

  const handleDragMove = (e) => {
    const id = e.target.id();
    console.log("handleDragMove", id, e.target.x(), e.target.y());
    setTargets(
      targets.map((target) =>
        target.id === id
          ? { ...target, x: e.target.x(), y: e.target.y() }
          : target
      )
    );
  };

  const [coppalse, setCollapse] = useState(false);

  return (
    <div className="w-full h-full" style={{ width: "100vw", height: "100vh" }}>
      <Stage
        ref={stageRef}
        width={size.width}
        height={size.height}
        draggable
        onMouseEnter={() => setStageCursor("grab")}
        onMouseDown={() => setStageCursor("grabbing")}
        onMouseUp={() => setStageCursor("grab")}
        onDragStart={() => setIsDragging(true)}
        onDragEnd={(e) => {
          setIsDragging(false);
          // you can read the current position if you need it
          // console.log('stage pos', e.target.position());
        }}
        onWheel={handleWheel}
      >
        <Layer>
          {/* Background grid - panning feels nicer with a visible background */}
          <Rect x={0} y={0} width={2000} height={2000} fill="#f7f7f7" />

          {/* Example shapes. IMPORTANT: call e.cancelBubble = true on shape mouseDown to prevent
the stage from receiving the mousedown if you want to interact with shapes. */}
          <Rect
            x={100}
            y={80}
            width={140}
            height={90}
            fill="#8ecae6"
            cornerRadius={6}
            shadowBlur={4}
            draggable
            onMouseDown={(e) => {
              // prevent stage from starting a pan when clicking this shape
              e.cancelBubble = true;
              // also change cursor when dragging the shape
              setStageCursor("grabbing");
            }}
            onDragEnd={() => setStageCursor("grab")}
          />

          <Circle
            x={420}
            y={240}
            radius={60}
            fill="#ffb703"
            draggable
            onMouseDown={(e) => (e.cancelBubble = true)}
          />

          <Text
            x={80}
            y={200}
            text={
              isDragging
                ? "Panning..."
                : "Drag the background to pan. Zoom with mouse wheel."
            }
          />

          {/* add more content as needed */}

          {connectors.map((connector) => {
            const fromNode = targets.find((t) => t.id === connector.from);
            const toNode = targets.find((t) => t.id === connector.to);
            if (!fromNode || !toNode) return null;

            const points = getConnectorPoints(fromNode, toNode);

            return (
              <Arrow
                key={connector.id}
                id={connector.id}
                points={points}
                fill="black"
                stroke="black"
              />
            );
          })}
          {targets.map((target) => (
            <Circle
              key={target.id}
              id={target.id}
              x={target.x}
              y={target.y}
              radius={target.radius}
              stroke="black" // border color
              shadowColor="transparent"
              strokeWidth={4} // border thickness
              fill="transparent" // make interior transparent / hollow
              shadowBlur={10}
              draggable
              onDragMove={handleDragMove}
            />
          ))}

          <Combo
            x={100}
            y={100}
            radius={20}
            collapsed={coppalse}
            onCollapse={() => setCollapse((c) => !c)}
            label={{ text: "Combo" }}
          />
        </Layer>
      </Stage>
    </div>
  );
}
