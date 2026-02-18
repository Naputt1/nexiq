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
    this.radius = data.radius ?? (this.collapsed ? this.collapsedRadius : this.expandedRadius);
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

    group.on("dragstart", (e) => {
      if (e.evt && e.evt.button !== 0) {
        group.stopDrag();
        return;
      }
      e.cancelBubble = true;
      context.graph.setDraggingId(this.id);
    });

    group.on("dragmove", (e) => {
      if (e.evt && e.evt.button !== 0) {
        group.stopDrag();
        return;
      }
      e.cancelBubble = true;
      context.graph.comboDragMove(this.id, e);
    });

    group.on("dragend", (e) => {
      e.cancelBubble = true;
      context.graph.setDraggingId(null);
      context.graph.comboDragEnd(this.id, e);
    });

    // Background Circle
    const radius = this.collapsed ? this.collapsedRadius : this.expandedRadius;
    const highlightColor = context.customColors?.comboHighlight || (context.theme === "dark" ? "#3b82f6" : "#2563eb");
    
    const fillColor = this.getFillColor(context);

    const bg = new Konva.Circle({
      id: `bg-${this.id}`,
      radius: radius,
      stroke: this.highlighted ? highlightColor : (context.theme === "dark" ? "#555" : fillColor),
      strokeWidth: this.highlighted ? 4 * this.scale : 2 * this.scale,
      fill: this.collapsed ? fillColor : "transparent",
      perfectDrawEnabled: false,
      shadowColor: highlightColor,
      shadowBlur: 40 * this.scale,
      shadowOpacity: 1,
      shadowOffset: { x: 0, y: 0 },
      shadowEnabled: !!this.highlighted,
    });

    group.on("mousedown", (e) => {
      const isLeft = e.evt.button === 0;
      group.draggable(isLeft);
      if (e.evt.button === 1) {
        e.cancelBubble = true;
        context.stage.startDrag();
        context.stage.container().style.cursor = "grabbing";
      }
    });

    group.on("mouseup", () => {
      group.draggable(true);
    });

    group.on("mouseleave", () => {
      group.draggable(true);
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
      if (e.cancelBubble) return;
      if (e.evt.ctrlKey) {
        e.cancelBubble = true;
        window.ipcRenderer.invoke("open-vscode", this.fileName);
      } else {
        e.cancelBubble = true;
        context.onSelect?.(this.id, false);
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

    if (context.registerItem) {
      context.registerItem(this.id, group);
    }

    parent.add(group);
    return group;
  }

  getFillColor(context: RenderContext): string {
    let fillColor = this.color;
    if (context.customColors) {
      if (this.type === "component") {
        fillColor =
          context.customColors.componentNode ||
          (context.theme === "dark" ? "#3b82f6" : "#2563eb");
      }
      if (this.type === "hook") {
        fillColor =
          context.customColors.hookNode ||
          (context.theme === "dark" ? "#8b5cf6" : "#7c3aed"); // Purple for hooks
      }
      // Add other combo types if they exist, e.g. props combo
      if (this.id.endsWith("-props")) {
        fillColor = context.customColors.propNode || "#22c55e";
      }
      if (this.id.endsWith("-render")) {
        fillColor =
          context.customColors.renderNode ||
          (context.theme === "dark" ? "#3b82f6" : "#2563eb");
      }
      if (this.type === "jsx") {
        fillColor = "#f97316"; // orange
      }
    }
    return fillColor;
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
          childCombo.expandedRadius;
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
