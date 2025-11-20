import type Konva from "konva";
import React from "react";
import { useEffect, useRef, useState } from "react";
import { Group, Text } from "react-konva";

interface LabelProps extends React.ComponentProps<typeof Text> {
  children?: React.ReactNode;
  x?: number;
  y?: number;
  offsetX?: number;
  offsetY?: number;
  text?: string;
  onDragMove?: (evt: Konva.KonvaEventObject<DragEvent>) => void;
}

export type LabelData = Omit<
  React.ComponentProps<typeof Text>,
  "x" | "y" | "align"
>;

const Label: React.FC<LabelProps> = ({
  children,
  x = 0,
  y = 0,
  offsetX = 0,
  offsetY = 0,
  onDragMove,
  ...props
}) => {
  const textRef = useRef<Konva.Text>(null);
  const [textOffset, setTextOffset] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });

  useEffect(() => {
    if (textRef.current) {
      const width = textRef.current.width();
      const height = textRef.current.height();
      setTextOffset({ x: -width / 2, y: -height / 2 });
      // textRef.current.offsetX(width / 2);
      // textRef.current.offsetY(height / 2);
    }
  }, [props.text]);

  return (
    <Group
      draggable
      onDragMove={onDragMove}
      perfectDrawEnabled={false}
      x={x}
      y={y}
    >
      {children}
      <Text
        ref={textRef}
        x={offsetX + textOffset.x}
        y={offsetY + textOffset.y}
        align="center"
        {...props}
        perfectDrawEnabled={false}
      />
    </Group>
  );
};

export default Label;
