import Konva from "konva";
import type { CurRender, RenderContext, GraphNode, GraphArrow, GraphComboData } from ".";
import { BaseNode } from "./baseNode";

export class GraphCombo extends BaseNode {
  collapsed: boolean;
  collapsedRadius: number;
  expandedRadius: number;
  padding: number;
  child?: CurRender;

  constructor(data: GraphComboData) {
    super(data);
    this.collapsed = data.collapsed ?? true;
    this.collapsedRadius = data.collapsedRadius ?? 20;
    this.expandedRadius = data.expandedRadius ?? 40;
    this.padding = data.padding ?? 10;
    this.radius = this.collapsed ? this.collapsedRadius : this.expandedRadius;
    this.child = data.child;
  }

  render(context: RenderContext, parent: Konva.Container): Konva.Group {
    if (this.visible === false) return new Konva.Group();

    const group = new Konva.Group({
      id: this.id,
      x: this.x,
      y: this.y,
      draggable: true,
      opacity: context.hasGitChanges && !this.gitStatus ? 0.2 : 1,
    });

    group.on("dragmove", (e) => {
      e.cancelBubble = true;
      context.graph.comboDragMove(this.id, e);
    });

    group.on("dragend", (e) => {
      e.cancelBubble = true;
      context.graph.comboDragEnd(this.id, e);
    });

    // Background Circle
    const radius = this.collapsed ? this.collapsedRadius : this.expandedRadius;
    const highlightColor = context.customColors?.comboHighlight || (context.theme === "dark" ? "#3b82f6" : "#2563eb");
    
    let fillColor = this.color;
    if (context.customColors) {
      if (this.type === "component") {
        fillColor = context.customColors.componentNode || (context.theme === "dark" ? "#3b82f6" : "#2563eb");
      }
      // Add other combo types if they exist, e.g. props combo
      if (this.id.endsWith("-props")) {
        fillColor = context.customColors.propNode || "#22c55e";
      }
      if (this.id.endsWith("-render")) {
        fillColor = context.customColors.renderNode || (context.theme === "dark" ? "#3b82f6" : "#2563eb");
      }
    }

    const bg = new Konva.Circle({
      id: `bg-${this.id}`,
      radius: radius,
      stroke: this.highlighted ? highlightColor : (context.theme === "dark" ? "#555" : fillColor),
      strokeWidth: this.highlighted ? 4 : 2,
      fill: this.collapsed ? fillColor : "transparent",
      perfectDrawEnabled: false,
      shadowColor: highlightColor,
      shadowBlur: 40,
      shadowOpacity: 1,
      shadowOffset: { x: 0, y: 0 },
      shadowEnabled: !!this.highlighted,
    });

    bg.on("mouseenter", () => {
      context.stage.container().style.cursor = "pointer";
    });
    bg.on("mouseleave", () => {
      context.stage.container().style.cursor = "grab";
    });

    bg.on("dblclick", (e) => {
      e.cancelBubble = true;
      context.graph.comboCollapsed(this.id);
    });

    bg.on("click", (e) => {
      if (e.evt.cancelBubble) return;
      if (e.evt.ctrlKey) {
        e.cancelBubble = true;
        window.ipcRenderer.invoke("open-vscode", this.fileName);
      } else {
        e.cancelBubble = true;
        context.onSelect?.(this.id);
      }
    });

    group.add(bg);

    // Content Group
    const contentGroup = new Konva.Group({
      id: `content-${this.id}`,
    });
    group.add(contentGroup);

    // If not collapsed, render children
    if (!this.collapsed && this.child) {
      // Enable clipping on contentGroup
      contentGroup.clipFunc((ctx) => {
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2, false);
        ctx.closePath();
      });

      for (const edge of Object.values(this.child.edges) as GraphArrow[]) {
        edge.render(context, contentGroup);
      }
      for (const sub of Object.values(this.child.combos) as GraphCombo[]) {
        sub.render(context, contentGroup);
      }
      for (const node of Object.values(this.child.nodes) as GraphNode[]) {
        node.render(context, contentGroup);
      }
    }

    // Label
    this.renderLabel(group, radius + 10 * this.scale, context);

    // Git Status
    this.renderGitStatus(group, radius, 6, context);

    parent.add(group);
    return group;
  }

  calculateRadius(configMaxRadius: number): number {
    let maxR = 0;

    if (this.child) {
      for (const node of Object.values(this.child.nodes)) {
        const dist = Math.sqrt(node.x * node.x + node.y * node.y) + node.radius;
        if (dist > maxR) maxR = dist;
      }

      for (const childCombo of Object.values(this.child.combos)) {
        const dist =
          Math.sqrt(childCombo.x * childCombo.x + childCombo.y * childCombo.y) +
          childCombo.radius;
        if (dist > maxR) maxR = dist;
      }
    }

    return Math.max(
      maxR + this.padding * this.scale,
      this.collapsedRadius,
      configMaxRadius * this.scale,
    );
  }

  updateRadius(configMaxRadius: number) {
    const radius = this.calculateRadius(configMaxRadius);
    this.expandedRadius = radius;
    if (!this.collapsed) {
      this.radius = radius;
    }
  }
}
