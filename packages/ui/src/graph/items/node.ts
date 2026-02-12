import Konva from "konva";
import { BaseNode } from "./baseNode";
import type { GraphNodeData, RenderContext } from ".";

export class GraphNode extends BaseNode {
  constructor(data: GraphNodeData) {
    super(data);
  }

  render(context: RenderContext, parent: Konva.Container): Konva.Group {
    const group = new Konva.Group({
      id: this.id,
      x: this.x,
      y: this.y,
      draggable: true,
      opacity: context.hasGitChanges && !this.gitStatus ? 0.2 : 1,
    });

    group.on("dragmove", (e) => {
      e.cancelBubble = true;
      if (this.parent) {
        context.graph.comboChildNodeMove(this.parent.id, this.id, e);
      } else {
        context.graph.nodeDragMove(this.id, e);
      }
    });

    group.on("dragend", (e) => {
      e.cancelBubble = true;
      if (this.parent) {
        context.graph.comboChildNodeEnd(this.parent.id, this.id);
      } else {
        context.graph.nodeDragEnd(this.id, e);
      }
    });

    group.on("click", (e) => {
      if (e.evt.ctrlKey) {
        e.cancelBubble = true;
        window.ipcRenderer.invoke("open-vscode", this.fileName);
      } else {
        e.cancelBubble = true;
        context.onSelect?.(this.id);
      }
    });

    const circle = new Konva.Circle({
      radius: this.radius,
      fill: this.color,
      stroke: this.highlighted ? "#007AFF" : undefined,
      strokeWidth: this.highlighted ? 2 : 0,
      perfectDrawEnabled: false,
      shadowColor: "#007AFF",
      shadowBlur: 20,
      shadowOpacity: 1,
      shadowOffset: { x: 0, y: 0 },
      shadowEnabled: !!this.highlighted,
    });

    group.add(circle);

    if (this.label) {
      this.renderLabel(group, (this.radius || 0) + 10 * this.scale);
    }

    this.renderGitStatus(group, this.radius, 4);

    parent.add(group);
    return group;
  }
}
