import Konva from "konva";
import {
  GraphData,
  type GraphDataCallbackParams,
  type ComboGraphData,
  type NodeGraphData,
  type EdgeGraphData,
} from "./hook";

export class GraphRenderer {
  stage: Konva.Stage;
  layer: Konva.Layer;
  graph: GraphData;
  onSelect?: (id: string) => void;
  onViewportChange?: (viewport: { x: number; y: number; zoom: number }) => void;

  private items = new Map<string, Konva.Group | Konva.Circle | Konva.Arrow>();
  private edges = new Map<string, Konva.Arrow>();
  private combos = new Map<string, Konva.Group>();
  private nodes = new Map<string, Konva.Circle>();

  private bindId: string | null = null;
  private animatingCombos = new Set<string>();
  private animations = new Map<string, Konva.Animation>();

  constructor(
    container: HTMLDivElement,
    graph: GraphData,
    width: number,
    height: number,
    onSelect?: (id: string) => void,
    onViewportChange?: (viewport: { x: number; y: number; zoom: number }) => void,
  ) {
    this.stage = new Konva.Stage({
      container,
      width,
      height,
      draggable: true,
    });

    this.layer = new Konva.Layer();
    this.stage.add(this.layer);
    this.graph = graph;
    this.onSelect = onSelect;
    this.onViewportChange = onViewportChange;

    this.setupStageEvents();
    this.bindId = this.graph.bind(this.handleGraphEvent.bind(this));

    // Initial render
    this.render();
  }

  destroy() {
    this.stopAllAnimations();
    if (this.bindId) {
      this.graph.unbind(this.bindId);
    }
    this.stage.destroy();
  }

  private stopAllAnimations() {
    this.animations.forEach((a) => a.stop());
    this.animations.clear();
    this.animatingCombos.clear();
  }

  resize(width: number, height: number) {
    this.stage.width(width);
    this.stage.height(height);
  }

  focusItem(id: string, scale: number = 1.5) {
    const pos = this.graph.getAbsolutePosition(id);
    if (pos) {
      this.zoomTo(pos.x, pos.y, scale);
    }
  }

  private zoomTo(x: number, y: number, scale: number) {
    const newPos = {
      x: this.stage.width() / 2 - x * scale,
      y: this.stage.height() / 2 - y * scale,
    };

    this.stage.to({
      x: newPos.x,
      y: newPos.y,
      scaleX: scale,
      scaleY: scale,
      duration: 0.3,
      easing: Konva.Easings.EaseInOut,
    });
  }

  setViewport(x: number, y: number, zoom: number) {
    this.stage.position({ x, y });
    this.stage.scale({ x: zoom, y: zoom });
  }

  private triggerViewportChange() {
    if (this.onViewportChange) {
      this.onViewportChange({
        x: this.stage.x(),
        y: this.stage.y(),
        zoom: this.stage.scaleX(),
      });
    }
  }

  private setupStageEvents() {
    const stage = this.stage;

    stage.on("wheel", (e) => {
      e.evt.preventDefault();

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

      const scaleBy = 1.1;
      const newScale = direction > 0 ? oldScale * scaleBy : oldScale / scaleBy;

      stage.scale({ x: newScale, y: newScale });

      const newPos = {
        x: pointer.x - mousePointTo.x * newScale,
        y: pointer.y - mousePointTo.y * newScale,
      };

      stage.position(newPos);
      this.triggerViewportChange();
    });

    stage.on("dragend", () => {
      this.triggerViewportChange();
    });

    stage.on("mouseenter", () => (stage.container().style.cursor = "grab"));
    stage.on("mousedown", (e) => {
      if (e.evt.button === 1) {
        // Middle mouse button
        e.evt.preventDefault();
        stage.startDrag();
      }
      if (e.evt.button === 0 || e.evt.button === 1) {
        stage.container().style.cursor = "grabbing";
      }
    });
    stage.on("mouseup", () => (stage.container().style.cursor = "grab"));
  }

  private handleGraphEvent(params: GraphDataCallbackParams) {
    switch (params.type) {
      case "new-nodes":
      case "new-combos":
      case "new-edges":
        this.render();
        break;
      case "combo-collapsed":
        this.handleComboCollapsed(params.id);
        break;
      case "combo-drag-move":
        this.handleComboDragMove(params.id, params.edgeIds);
        break;
      case "node-drag-move":
        this.updateEdges(params.edgeIds);
        break;
      case "combo-radius-change":
        this.handleComboRadiusChange(params.id, params.edgeIds);
        break;
      case "combo-drag-end":
      case "node-drag-end":
        this.render();
        break;
      case "layout-change":
      case "child-moved":
        this.handleLayoutChange();
        break;
    }
  }

  private handleComboCollapsed(id: string) {
    const combo = this.graph.getCombo(id);
    if (!combo) return;

    const group = this.combos.get(id);
    if (!group) return;

    const circle = group.findOne(`#bg-${id}`) as Konva.Circle;
    if (!circle) return;

    // Get OR Create content group
    let contentGroup = group.findOne<Konva.Group>(`#content-${id}`);
    if (!contentGroup) {
      contentGroup = new Konva.Group({ id: `content-${id}` });
      const bgIndex = group.getChildren().indexOf(circle);
      group.add(contentGroup);
      contentGroup.zIndex(bgIndex + 1);
    }

    const startRadius = circle.radius();

    // Stop any existing animation on this combo
    if (this.animations.has(id)) {
      this.animations.get(id)?.stop();
      this.animations.delete(id);
    }

    // Handle children visibility/creation
    if (combo.collapsed) {
      // Collapsing: Remove children immediately
      contentGroup.destroyChildren();

      // Fill color immediately when collapsing
      circle.fill(combo.color);
      contentGroup.clipFunc(null);
    } else {
      // Expanding: Render children into contentGroup
      if (combo.child) {
        this.renderEdges(combo.child.edges, contentGroup);
        for (const sub of Object.values(combo.child.combos)) {
          this.renderCombo(sub, contentGroup);
        }
        for (const node of Object.values(combo.child.nodes)) {
          this.renderNode(node, contentGroup);
        }
      }
      // Transparent immediately when expanding
      circle.fill("transparent");
      // Enable clipping on contentGroup
      contentGroup.clipFunc((ctx) => {
        ctx.beginPath();
        ctx.arc(0, 0, circle.radius(), 0, Math.PI * 2, false);
        ctx.closePath();
      });
    }

    this.animatingCombos.add(id);

    // Animate radius
    const anim = new Konva.Animation((frame) => {
      if (!frame) return;
      const duration = 300; // ms
      const time = Math.min(frame.time, duration);
      const rate = time / duration;
      // EaseInOut
      const t = rate < 0.5 ? 2 * rate * rate : -1 + (4 - 2 * rate) * rate;

      const currentTargetRadius = combo.collapsed
        ? combo.collapsedRadius
        : combo.expandedRadius;
      const currentR = startRadius + (currentTargetRadius - startRadius) * t;

      circle.radius(currentR);
      this.graph.comboRadiusChange(id, currentR);

      // Update Label position
      const label = group.findOne(`#label-${id}`) as Konva.Text;
      if (label) {
        label.y(currentR + 10 * combo.scale);
      }

      if (time >= duration) {
        anim.stop();
        this.animations.delete(id);
        this.animatingCombos.delete(id);
        // Ensure final state
        circle.radius(currentTargetRadius);

        // Cleanup clip
        contentGroup.clipFunc(null);

        // Ensure final fill
        circle.fill(combo.collapsed ? combo.color : "transparent");
      }
    }, this.layer);

    this.animations.set(id, anim);
    anim.start();
  }

  private handleComboDragMove(_id: string, edgeIds: string[]) {
    // The combo group position is already updated by the drag event
    // We just need to update the edges
    this.updateEdges(edgeIds);
  }

  private handleComboRadiusChange(id: string, edgeIds: string[]) {
    if (this.animatingCombos.has(id)) {
      // If animating, only update edges (which depend on new radius in data)
      // Do NOT set radius/label here, let animation drive it.
      this.updateEdges(edgeIds);
      return;
    }

    const combo = this.graph.getCombo(id);
    if (!combo) return;

    const group = this.combos.get(id);
    if (!group) return;

    const circle = group.findOne(`#bg-${id}`) as Konva.Circle;
    // Just update radius immediately without animation
    const radius = combo.collapsed
      ? combo.collapsedRadius
      : combo.expandedRadius;

    if (circle) {
      circle.radius(radius);
    }

    // Update label position
    const label = group.findOne(`#label-${id}`) as Konva.Text;
    if (label) {
      label.y(radius + 10 * combo.scale);
    }

    this.updateEdges(edgeIds);
  }

  private updateEdges(edgeIds: string[]) {
    for (const eid of edgeIds) {
      const edgeData = this.graph.getEdge(eid);
      const arrow = this.edges.get(eid);
      if (edgeData && arrow) {
        if (edgeData.points.length < 4) {
          arrow.visible(false);
        } else {
          arrow.visible(true);
          arrow.points(edgeData.points);
          arrow.strokeWidth(0.5 * edgeData.scale);
          arrow.pointerWidth(6 * edgeData.scale);
          arrow.pointerLength(6 * edgeData.scale);
        }
      }
    }
  }


  private handleLayoutChange() {
    this.combos.forEach((group, id) => {
      const combo = this.graph.getCombo(id);
      if (combo) {
        group.position({ x: combo.x, y: combo.y });
        // Also update radius if not animating
        if (!this.animatingCombos.has(id)) {
          const circle = group.findOne(`#bg-${id}`) as Konva.Circle;
          if (circle) {
            const radius = combo.collapsed
              ? combo.collapsedRadius
              : combo.expandedRadius;
            circle.radius(radius);
            const label = group.findOne(`#label-${id}`) as Konva.Text;
            if (label) label.y(radius + 10 * combo.scale);
          }
        }
      }
    });

    this.items.forEach((item, id) => {
      if (item instanceof Konva.Group && !this.combos.has(id)) {
        const node = this.graph.getNode(id);
        if (node) {
          item.position({ x: node.x, y: node.y });
        }
      }
    });

    this.updateEdges(Array.from(this.edges.keys()));
    this.layer.batchDraw();
  }

  render() {
    this.stopAllAnimations();
    this.layer.destroyChildren();
    this.items.clear();
    this.combos.clear();
    this.nodes.clear();
    this.edges.clear();

    const combos = this.graph.getCurCombos();
    const nodes = this.graph.getCurNodes();
    const edges = this.graph.getCurEdges();

    // Render Edges first (bottom)
    this.renderEdges(edges);

    // Render Combos
    for (const combo of Object.values(combos)) {
      this.renderCombo(combo, this.layer);
    }

    // Render Nodes
    for (const node of Object.values(nodes)) {
      this.renderNode(node, this.layer);
    }

    this.layer.batchDraw();
  }

  private renderEdges(
    edges: Record<string, EdgeGraphData>,
    parent?: Konva.Group,
  ) {
    for (const edge of Object.values(edges)) {
      const arrow = new Konva.Arrow({
        id: edge.id,
        points: edge.points,
        fill: "#424242",
        stroke: "#666666",
        strokeWidth: 0.5 * edge.scale,
        pointerWidth: 6 * edge.scale,
        pointerLength: 6 * edge.scale,
        lineJoin: "round",
        perfectDrawEnabled: false,
        listening: false,
      });

      // Add to parent or layer
      if (parent) parent.add(arrow);
      else this.layer.add(arrow);

      this.edges.set(edge.id, arrow);
      this.items.set(edge.id, arrow);
    }
  }

  private renderCombo(combo: ComboGraphData, parent: Konva.Container) {
    const group = new Konva.Group({
      id: combo.id,
      x: combo.x,
      y: combo.y,
      draggable: true,
    });

    group.on("dragmove", (e) => {
      e.cancelBubble = true;
      this.graph.comboDragMove(combo.id, e);
    });

    group.on("dragend", (e) => {
      e.cancelBubble = true;
      this.graph.comboDragEnd(combo.id, e);
    });

    // Background Circle
    const radius = combo.collapsed
      ? combo.collapsedRadius
      : combo.expandedRadius;
    const bg = new Konva.Circle({
      id: `bg-${combo.id}`,
      radius: radius,
      stroke: combo.highlighted ? "#007AFF" : combo.color,
      strokeWidth: combo.highlighted ? 4 : 2,
      fill: combo.collapsed ? combo.color : "transparent",
      perfectDrawEnabled: false,
      shadowColor: "#007AFF",
      shadowBlur: 40,
      shadowOpacity: 1,
      shadowOffset: { x: 0, y: 0 },
      shadowEnabled: !!combo.highlighted,
    });

    bg.on("mouseenter", () => {
      this.graph.calculateComboChildrenLayout(combo.id);
      this.stage.container().style.cursor = "pointer";
    });
    bg.on("mouseleave", () => {
      this.stage.container().style.cursor = "grab";
    });

    bg.on("dblclick", (e) => {
      e.cancelBubble = true;
      this.graph.comboCollapsed(combo.id);
    });

    bg.on("click", (e) => {
      if (e.evt.cancelBubble) return;
      if (e.evt.ctrlKey) {
        e.cancelBubble = true;
        window.ipcRenderer.invoke("open-vscode", combo.fileName as string);
      } else {
        e.cancelBubble = true;
        this.onSelect?.(combo.id);
      }
    });

    group.add(bg);

    // Content Group (Clipped)
    const contentGroup = new Konva.Group({
      id: `content-${combo.id}`,
    });
    group.add(contentGroup);

    // If not collapsed, render children into contentGroup
    if (!combo.collapsed) {
      if (combo.child) {
        this.renderEdges(combo.child.edges, contentGroup);

        for (const sub of Object.values(combo.child.combos)) {
          this.renderCombo(sub, contentGroup);
        }
        for (const node of Object.values(combo.child.nodes)) {
          this.renderNode(node, contentGroup);
        }
      }
    }

    // Label (Outside content group)
    this.renderLabel(combo, group, radius + 10 * combo.scale);

    parent.add(group);
    this.combos.set(combo.id, group);
    this.items.set(combo.id, group);
  }

  private renderLabel(
    item: ComboGraphData | NodeGraphData,
    group: Konva.Group,
    offsetY: number,
  ) {
    if (!item.label) return;

    const text = new Konva.Text({
      id: `label-${item.id}`,
      text: item.label.text,
      fill: item.label.fill || "black",
      fontSize: 12 * item.scale, // Scale font size
      align: "center",
      y: offsetY,
    });

    // Center the text horizontally
    text.offsetX(text.width() / 2);

    group.add(text);
  }

  private renderNode(node: NodeGraphData, parent: Konva.Container) {
    const group = new Konva.Group({
      id: node.id,
      x: node.x,
      y: node.y,
      draggable: true,
    });

    group.on("dragmove", (e) => {
      e.cancelBubble = true;
      if (node.combo) {
        this.graph.comboChildNodeMove(node.combo, node.id, e);
      } else {
        this.graph.nodeDragMove(node.id, e);
      }
    });

    group.on("dragend", (e) => {
      e.cancelBubble = true;
      if (node.combo) {
        this.graph.comboChildNodeEnd(node.combo, node.id);
      } else {
        this.graph.nodeDragEnd(node.id, e);
      }
    });

    group.on("click", (e) => {
      if (e.evt.ctrlKey) {
        e.cancelBubble = true;
        window.ipcRenderer.invoke("open-vscode", node.fileName as string);
      } else {
        e.cancelBubble = true;
        this.onSelect?.(node.id);
      }
    });

    const circle = new Konva.Circle({
      radius: node.radius,
      fill: node.color,
      stroke: node.highlighted ? "#007AFF" : undefined,
      strokeWidth: node.highlighted ? 2 : 0,
      perfectDrawEnabled: false,
      shadowColor: "#007AFF",
      shadowBlur: 20,
      shadowOpacity: 1,
      shadowOffset: { x: 0, y: 0 },
      shadowEnabled: !!node.highlighted,
    });

    group.add(circle);

    if (node.label) {
      this.renderLabel(node, group, (node.radius || 0) + 10 * node.scale);
    }

    parent.add(group);
    this.nodes.set(node.id, circle);
    this.items.set(node.id, group);
  }
}
