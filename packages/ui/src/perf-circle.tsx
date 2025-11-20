import { Circle, Label, Layer, Tag, Text } from "react-konva";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import DragableStage from "./graph/dragableGraph";

const CirclesLayer = ({
  nodes,
  onMouseOver,
  onMouseMove,
  onMouseOut,
  onMouseDown,
  onMouseUp,
}) => {
  // Only re-render when the nodes array reference changes
  return (
    <Layer>
      {nodes.map((node) => (
        <Circle
          key={node.id}
          x={node.x}
          y={node.y}
          radius={4}
          fill={node.color}
          onMouseOver={(e) => onMouseOver(e, node)}
          onMouseMove={onMouseMove}
          onMouseOut={onMouseOut}
          onDragMove={onMouseMove}
          onMouseDown={(e) => onMouseDown(e, node)}
          onMouseUp={(e) => onMouseUp(e, node)}
          draggable
        />
      ))}
    </Layer>
  );
};

// Memoize the CirclesLayer component to prevent unnecessary re-renders
const MemoizedCirclesLayer = memo(CirclesLayer);

const TooltipLayer = ({ tooltip }) => (
  <Layer>
    <Label x={tooltip.x} y={tooltip.y} opacity={0.75} visible={tooltip.visible}>
      <Tag
        fill="black"
        pointerDirection="down"
        pointerWidth={10}
        pointerHeight={10}
        lineJoin="round"
        shadowColor="black"
        shadowBlur={10}
        shadowOffsetX={10}
        shadowOffsetY={10}
        shadowOpacity={0.2}
      />
      <Text
        text={tooltip.text}
        fontFamily="Calibri"
        fontSize={18}
        padding={5}
        fill="white"
      />
    </Label>
  </Layer>
);

// Memoize the TooltipLayer to only re-render when tooltip props change
const MemoizedTooltipLayer = memo(TooltipLayer);

const AppTest = () => {
  const width = window.innerWidth;
  const height = window.innerHeight;

  // Create refs for the layers
  const dragLayerRef = useRef(null);

  // State for tooltip
  const [tooltip, setTooltip] = useState({
    visible: false,
    x: 0,
    y: 0,
    text: "",
  });

  // State for nodes data - using useMemo to ensure it doesn't regenerate on re-renders
  const nodes = useMemo(() => {
    const colors = ["red", "orange", "cyan", "green", "blue", "purple"];
    const data = [];

    for (let n = 0; n < 20000; n++) {
      const x = Math.random() * width;
      const y = height + Math.random() * 200 - 100 + (height / width) * -1 * x;
      data.push({
        x,
        y,
        id: n,
        color: colors[Math.round(Math.random() * 5)],
      });
    }

    return data;
  }, [width, height]);

  // Event handlers - wrap in useCallback to prevent recreating functions on each render
  const handleMouseOver = useCallback((e, node) => {
    const stage = e.target.getStage();
    const pos = stage.getPointerPosition();
    setTooltip({
      visible: true,
      x: pos.x,
      y: pos.y - 5,
      text: `node: ${node.id}, color: ${node.color}`,
    });
  }, []);

  const handleMouseMove = useCallback((e) => {
    const stage = e.target.getStage();
    const pos = stage.getPointerPosition();
    setTooltip((prev) => ({
      ...prev,
      x: pos.x,
      y: pos.y - 5,
    }));
  }, []);

  const handleMouseOut = useCallback(() => {
    setTooltip((prev) => ({
      ...prev,
      visible: false,
    }));
  }, []);

  const handleMouseDown = useCallback((e, node) => {
    // For drag handling if needed
  }, []);

  const handleMouseUp = useCallback((e, node) => {
    // For drag handling if needed
  }, []);

  return (
    <DragableStage width={width} height={height}>
      {/* Render single layer for all circles */}
      <MemoizedCirclesLayer
        nodes={nodes}
        onMouseOver={handleMouseOver}
        onMouseMove={handleMouseMove}
        onMouseOut={handleMouseOut}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
      />

      {/* Drag layer - if needed */}
      <Layer ref={dragLayerRef} />

      {/* Tooltip layer */}
      <MemoizedTooltipLayer tooltip={tooltip} />
    </DragableStage>
  );
};

export default AppTest;
