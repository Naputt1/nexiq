import Konva from "konva";
import type { BaseNode } from "./baseNode";
import type { GraphArrowData, Renderable, RenderContext } from ".";

export class GraphArrow implements Renderable {
  id: string;
  source: string;
  target: string;
  points: number[] = [];
  scale: number = 1;
  combo?: string;
  visible: boolean = true;
  opacity: number = 1;

  constructor(data: GraphArrowData) {
    this.id = data.id;
    this.source = data.source;
    this.target = data.target;
    this.combo = data.combo;
    this.scale = data.scale ?? 1;
    this.points = data.points ?? [];
    this.visible = data.visible ?? true;
    this.opacity = data.opacity ?? 1;
  }

  updatePoints(from: BaseNode, to: BaseNode, relativeTo?: BaseNode) {
    const fromAbs = from.getAbsolutePosition();
    const toAbs = to.getAbsolutePosition();

    let fromPos = fromAbs;
    let toPos = toAbs;

    if (relativeTo) {
      const relAbs = relativeTo.getAbsolutePosition();
      fromPos = { x: fromAbs.x - relAbs.x, y: fromAbs.y - relAbs.y };
      toPos = { x: toAbs.x - relAbs.x, y: toAbs.y - relAbs.y };
    }

    const dx = toPos.x - fromPos.x;
    const dy = toPos.y - fromPos.y;
    const angle = Math.atan2(-dy, dx);

    this.points = [
      fromPos.x + -from.radius * Math.cos(angle + Math.PI),
      fromPos.y + from.radius * Math.sin(angle + Math.PI),
      toPos.x + -to.radius * Math.cos(angle),
      toPos.y + to.radius * Math.sin(angle),
    ];
    this.scale = Math.min(from.scale, to.scale);
  }

  render(context: RenderContext, parent: Konva.Container): Konva.Arrow {
    const srcNode = context.graph.getPointByID(this.source);
    const targetNode = context.graph.getPointByID(this.target);

    // If either end is explicitly hidden or deleted, hide the edge
    const isVisible =
      srcNode?.visible !== false &&
      targetNode?.visible !== false &&
      srcNode?.gitStatus !== "deleted" &&
      targetNode?.gitStatus !== "deleted";

    const arrow = new Konva.Arrow({
      id: this.id,
      points: this.points,
      fill: context.customColors?.arrowColor || (context.theme === "dark" ? "#888" : "#424242"),
      stroke: context.customColors?.arrowColor || (context.theme === "dark" ? "#666" : "#666666"),
      strokeWidth: 0.5 * this.scale,
      pointerWidth: 6 * this.scale,
      pointerLength: 6 * this.scale,
      lineJoin: "round",
      perfectDrawEnabled: false,
      listening: false,
      visible: isVisible && this.points.length >= 4,
      opacity: context.hasGitChanges ? 0.1 : 1,
    });

    if (context.registerItem) {
      context.registerItem(this.id, arrow);
    }

    parent.add(arrow);

    return arrow;
  }
}
