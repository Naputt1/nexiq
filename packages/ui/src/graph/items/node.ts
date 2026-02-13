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
        context.onSelect?.(this.id, false);
      }
    });

    const highlightColor = context.customColors?.nodeHighlight || (context.theme === "dark" ? "#3b82f6" : "#2563eb");

    const fillColor = this.getFillColor(context);

    const circle = new Konva.Circle({
      radius: this.radius,
      fill: fillColor,
      stroke: this.highlighted ? highlightColor : undefined,
      strokeWidth: this.highlighted ? 2 * this.scale : 0,
      perfectDrawEnabled: false,
      shadowColor: highlightColor,
      shadowBlur: 20 * this.scale,
      shadowOpacity: 1,
      shadowOffset: { x: 0, y: 0 },
      shadowEnabled: !!this.highlighted,
    });

    group.add(circle);

    if (this.label) {
      this.renderLabel(group, (this.radius || 0) + 10 * this.scale, context);
    }

    this.renderGitStatus(group, this.radius, 4, context);

    if (context.registerItem) {
      context.registerItem(this.id, group);
    }

    parent.add(group);
    return group;
  }

  getFillColor(context: RenderContext): string {
    let fillColor = this.color;
    if (context.customColors) {
      switch (this.type) {
        case "state": fillColor = context.customColors.stateNode || "#ef4444"; break;
        case "memo": fillColor = context.customColors.memoNode || "#ef4444"; break;
        case "callback": fillColor = context.customColors.callbackNode || "#ef4444"; break;
        case "ref": fillColor = context.customColors.refNode || "#ef4444"; break;
        case "effect": fillColor = context.customColors.effectNode || "#eab308"; break;
        case "prop": fillColor = context.customColors.propNode || "#22c55e"; break;
        case "render": fillColor = context.customColors.renderNode || (context.theme === "dark" ? "#3b82f6" : "#2563eb"); break;
        case "component": fillColor = context.customColors.componentNode || (context.theme === "dark" ? "#3b82f6" : "#2563eb"); break;
        case "hook": fillColor = context.customColors.hookNode || (context.theme === "dark" ? "#8b5cf6" : "#7c3aed"); break;
        default: break;
      }
    }
    return fillColor;
  }
}
