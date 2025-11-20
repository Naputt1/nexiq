import { Stage } from "react-konva";
import { useRef } from "react";
import type Konva from "konva";

interface DragableStageProps extends React.ComponentProps<typeof Stage> {
  onDrag?: (isDrag: boolean) => void;
  zoomScale?: number;
}

const DragableStage: React.FC<DragableStageProps> = ({
  onDrag,
  children,
  zoomScale = 1.1,
  ...props
}) => {
  const stageRef = useRef<Konva.Stage | null>(null);

  const setStageCursor = (cursor: string) => {
    const container = stageRef.current && stageRef.current.container();
    if (container) container.style.cursor = cursor;
  };
  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();

    const stage = stageRef.current;
    if (!stage) return;

    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };

    let direction = e.evt.deltaY > 0 ? 1 : -1;

    if (e.evt.ctrlKey) {
      direction = -direction;
    }

    const scaleBy = zoomScale;
    const newScale = direction > 0 ? oldScale * scaleBy : oldScale / scaleBy;

    stage.scale({ x: newScale, y: newScale });

    const newPos = {
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    };
    stage.position(newPos);
  };

  return (
    <Stage
      ref={stageRef}
      draggable
      onMouseEnter={() => setStageCursor("grab")}
      onMouseDown={() => setStageCursor("grabbing")}
      onMouseUp={() => setStageCursor("grab")}
      onDragStart={() => {
        onDrag?.(true);
      }}
      onDragEnd={() => {
        onDrag?.(false);
      }}
      onWheel={handleWheel}
      {...props}
    >
      {children}
    </Stage>
  );
};

export default DragableStage;
