import Konva from "konva";
import {
  GraphData,
  type GraphDataCallbackParams,
} from "./hook";
import { GraphNode, GraphCombo, GraphArrow, type RenderContext } from "./items/index";

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
  public viewportChangeInProgress = false;

  constructor(
    container: HTMLDivElement,
    graph: GraphData,
    width: number,
    height: number,
    onSelect?: (id: string) => void,
    onViewportChange?: (viewport: {
      x: number;
      y: number;
      zoom: number;
    }) => void,
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

    let wheelTimeout: number | null = null;

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

      // Throttled viewport update for store
      this.viewportChangeInProgress = true;
      if (wheelTimeout) clearTimeout(wheelTimeout);
      wheelTimeout = setTimeout(() => {
        this.viewportChangeInProgress = false;
        this.triggerViewportChange();
        wheelTimeout = null;
      }, 200);
    });

    stage.on("dragmove", () => {
      // Don't trigger store updates while dragging
      this.viewportChangeInProgress = true;
    });

    stage.on("dragend", () => {
      this.viewportChangeInProgress = false;
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

    const context: RenderContext = {
      graph: this.graph,
      onSelect: this.onSelect,
      hasGitChanges: Object.values(this.graph.getCurCombos()).some((c: GraphCombo) => !!c.gitStatus) || Object.values(this.graph.getCurNodes()).some((n: GraphNode) => !!n.gitStatus),
      stage: this.stage,
    };

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
        for (const edge of Object.values(combo.child.edges) as GraphArrow[]) {
          edge.render(context, contentGroup);
        }
        for (const sub of Object.values(combo.child.combos) as GraphCombo[]) {
          sub.render(context, contentGroup);
        }
        for (const node of Object.values(combo.child.nodes) as GraphNode[]) {
          node.render(context, contentGroup);
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

      // Update Git Status Indicator position
      const indicator = group.findOne(`#git-status-${id}`) as Konva.Circle;
      if (indicator) {
        indicator.x(currentR * 0.7);
        indicator.y(-currentR * 0.7);
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

    // Update Git Status Indicator position
    const indicator = group.findOne(`#git-status-${id}`) as Konva.Circle;
    if (indicator) {
      indicator.x(radius * 0.7);
      indicator.y(-radius * 0.7);
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

            // Update Git Status Indicator position
            const indicator = group.findOne(
              `#git-status-${id}`,
            ) as Konva.Circle;
            if (indicator) {
              indicator.x(radius * 0.7);
              indicator.y(-radius * 0.7);
            }
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

    const hasGitChanges =
      Object.values(combos).some((c) => !!c.gitStatus) ||
      Object.values(nodes).some((n) => !!n.gitStatus);

    const context: RenderContext = {
      graph: this.graph,
      onSelect: this.onSelect,
      hasGitChanges,
      stage: this.stage,
    };

    // Render Edges first (bottom)
    for (const edge of Object.values(edges)) {
      const arrow = edge.render(context, this.layer);
      this.edges.set(edge.id, arrow);
      this.items.set(edge.id, arrow);
    }

    // Render Combos
    for (const combo of Object.values(combos)) {
      const group = combo.render(context, this.layer);
      this.combos.set(combo.id, group);
      this.items.set(combo.id, group);
    }

    // Render Nodes
    for (const node of Object.values(nodes)) {
      const group = node.render(context, this.layer);
      const circle = group.findOne("Circle") as Konva.Circle;
      if (circle) {
        this.nodes.set(node.id, circle);
      }
      this.items.set(node.id, group);
    }

    this.layer.batchDraw();
  }

}
