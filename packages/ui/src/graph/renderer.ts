import Konva from "konva";
import { GraphData, type GraphDataCallbackParams } from "./hook";
import {
  GraphNode,
  GraphCombo,
  GraphArrow,
  type RenderContext,
} from "./items/index";
import type { CustomColors } from "../../electron/types";

export class GraphRenderer {
  stage: Konva.Stage;
  layer: Konva.Layer;
  minimapLayer: Konva.Layer;
  graph: GraphData;
  onSelect?: (id: string, center?: boolean, highlight?: boolean) => void;
  onViewportChange?: (viewport: { x: number; y: number; zoom: number }) => void;
  theme: "dark" | "light" = "dark";
  customColors?: CustomColors;

  private items = new Map<string, Konva.Group | Konva.Circle | Konva.Arrow>();
  private edges = new Map<string, Konva.Arrow>();
  private combos = new Map<string, Konva.Group>();
  private nodes = new Map<string, Konva.Circle>();

  private bindId: string | null = null;
  private animatingCombos = new Set<string>();
  private animations = new Map<string, Konva.Animation>();
  public viewportChangeInProgress = false;

  private lastRenderedMinimapTimestamp: number = 0;
  private minimapContentGroup: Konva.Group | null = null;
  private resizeAnimationFrame: number | null = null;
  private minimapTimeout: ReturnType<typeof setTimeout> | null = null;

  private minimapSize = 150;
  private minimapPadding = 10;

  constructor(
    container: HTMLDivElement,
    graph: GraphData,
    width: number,
    height: number,
    onSelect?: (id: string, center?: boolean, highlight?: boolean) => void,
    onViewportChange?: (viewport: {
      x: number;
      y: number;
      zoom: number;
    }) => void,
    theme: "dark" | "light" = "dark",
    customColors?: CustomColors,
  ) {
    this.stage = new Konva.Stage({
      container,
      width,
      height,
      draggable: true,
      dragBoundFunc: (pos) => this.constrainViewport(pos),
    });

    this.layer = new Konva.Layer();
    this.stage.add(this.layer);

    this.minimapLayer = new Konva.Layer({
      listening: false, // Minimap is display-only for now
      visible: false,
    });
    this.stage.add(this.minimapLayer);

    this.graph = graph;
    this.onSelect = onSelect;
    this.onViewportChange = onViewportChange;
    this.theme = theme;
    this.customColors = customColors;

    this.setupStageEvents();
    this.bindId = this.graph.bind(this.handleGraphEvent.bind(this));

    // Initial render
    this.render();
  }

  private constrainViewport(pos: { x: number; y: number }) {
    const scale = this.stage.scaleX();
    const bounds = this.graph.getContentBounds();
    const padding = 100; // Allow some overflow

    // Content bounds in stage coordinates
    const minX = (bounds.minX - padding) * scale;
    const minY = (bounds.minY - padding) * scale;
    const maxX = (bounds.maxX + padding) * scale;
    const maxY = (bounds.maxY + padding) * scale;

    const width = this.stage.width();
    const height = this.stage.height();

    // Limit X such that at least some content is visible
    let newX = pos.x;
    if (newX + maxX < padding * scale) newX = padding * scale - maxX;
    if (newX + minX > width - padding * scale)
      newX = width - padding * scale - minX;

    let newY = pos.y;
    if (newY + maxY < padding * scale) newY = padding * scale - maxY;
    if (newY + minY > height - padding * scale)
      newY = height - padding * scale - minY;

    return { x: newX, y: newY };
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
    if (this.resizeAnimationFrame !== null) {
      cancelAnimationFrame(this.resizeAnimationFrame);
    }

    this.resizeAnimationFrame = requestAnimationFrame(() => {
      this.stage.width(width);
      this.stage.height(height);
      this.requestMinimapRender();
      this.resizeAnimationFrame = null;
    });
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
    this.requestMinimapRender();
  }

  setZoom(zoom: number) {
    const oldScale = this.stage.scaleX();
    const center = {
      x: this.stage.width() / 2,
      y: this.stage.height() / 2,
    };

    const mousePointTo = {
      x: (center.x - this.stage.x()) / oldScale,
      y: (center.y - this.stage.y()) / oldScale,
    };

    this.stage.scale({ x: zoom, y: zoom });

    const newPos = {
      x: center.x - mousePointTo.x * zoom,
      y: center.y - mousePointTo.y * zoom,
    };

    const constrainedPos = this.constrainViewport(newPos);
    this.stage.position(constrainedPos);
    this.requestMinimapRender();
    this.triggerViewportChange();
  }

  private requestMinimapRender() {
    this.minimapLayer.show();
    if (this.minimapTimeout) {
      clearTimeout(this.minimapTimeout);
    }
    this.renderMinimap();
    this.minimapTimeout = setTimeout(() => {
      this.minimapLayer.hide();
      this.minimapLayer.batchDraw();
      this.minimapTimeout = null;
    }, 2000);
  }

  public getZoomRange() {
    const bounds = this.graph.getContentBounds();
    const contentWidth = bounds.maxX - bounds.minX;
    const contentHeight = bounds.maxY - bounds.minY;
    const minScale = Math.min(
      this.stage.width() / (contentWidth + 400),
      this.stage.height() / (contentHeight + 400),
      0.1,
    );

    // Dynamically calculate max scale based on the deepest child
    const minItemScale = this.graph.getMinItemScale();
    const maxScale = Math.max(10, 2 / minItemScale);

    return { min: minScale, max: maxScale };
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
      let newScale = direction > 0 ? oldScale * scaleBy : oldScale / scaleBy;

      // Zoom constraints
      const { min: minScale, max: maxScale } = this.getZoomRange();

      if (newScale < minScale) newScale = minScale;
      if (newScale > maxScale) newScale = maxScale;

      stage.scale({ x: newScale, y: newScale });

      const newPos = {
        x: pointer.x - mousePointTo.x * newScale,
        y: pointer.y - mousePointTo.y * newScale,
      };

      // Apply constraints after zoom
      const constrainedPos = this.constrainViewport(newPos);
      stage.position(constrainedPos);

      this.requestMinimapRender();

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
      this.requestMinimapRender();
    });

    stage.on("dragend", () => {
      this.viewportChangeInProgress = false;
      this.triggerViewportChange();
    });

    stage.on("mouseenter", () => (stage.container().style.cursor = "grab"));
    stage.on("mousedown", (e) => {
      if (e.evt.button === 1) {
        // Middle mouse button - pan the canvas
        e.evt.preventDefault();
        // If we are over a draggable element, Konva might be starting a drag on it.
        // The children's dragstart handler will now handle button 0 check.
        stage.startDrag();
      }
      if (e.evt.button === 0 || e.evt.button === 1) {
        stage.container().style.cursor = "grabbing";
      }
    });
    stage.on("mouseup", () => (stage.container().style.cursor = "grab"));
  }

  private renderMinimap() {
    if (!this.minimapLayer.visible()) return;

    // Fix minimap layer to the screen by counteracting stage transform
    const stageScale = this.stage.scaleX();
    const invScale = 1 / stageScale;
    this.minimapLayer.scale({ x: invScale, y: invScale });
    this.minimapLayer.position({
      x: -this.stage.x() * invScale,
      y: -this.stage.y() * invScale,
    });

    const bounds = this.graph.getContentBounds();
    const contentWidth = bounds.maxX - bounds.minX;
    const contentHeight = bounds.maxY - bounds.minY;

    if (contentWidth <= 0 || contentHeight <= 0) return;

    const padding = 20;
    const totalWidth = contentWidth + padding * 2;
    const totalHeight = contentHeight + padding * 2;

    const scale = Math.min(
      this.minimapSize / totalWidth,
      this.minimapSize / totalHeight,
    );

    const mmWidth = totalWidth * scale;
    const mmHeight = totalHeight * scale;

    const xOffset = this.stage.width() - mmWidth - this.minimapPadding;
    const yOffset = this.minimapPadding;

    // Check if we need to redraw the dots/background
    const needsFullRedraw =
      !this.minimapContentGroup ||
      this.lastRenderedMinimapTimestamp < this.graph.lastModified;

    if (needsFullRedraw) {
      if (this.minimapContentGroup) {
        this.minimapContentGroup.destroy();
      }

      this.minimapContentGroup = new Konva.Group();
      this.minimapLayer.add(this.minimapContentGroup);

      // Minimap Background
      const bg = new Konva.Rect({
        x: xOffset,
        y: yOffset,
        width: mmWidth,
        height: mmHeight,
        fill: this.theme === "dark" ? "#1e1e1e" : "#f5f5f5",
        stroke: this.theme === "dark" ? "#333" : "#ddd",
        strokeWidth: 1,
        cornerRadius: 4,
        shadowBlur: 10,
        shadowOpacity: 0.2,
      });
      this.minimapContentGroup.add(bg);

      // Use a single custom shape to draw ALL dots at once - MUCH FASTER
      const combos = this.graph.getAllCombos();
      const nodes = this.graph.getAllNodes();

      const dotsShape = new Konva.Shape({
        sceneFunc: (ctx, shape) => {
          ctx.beginPath();

          const getMMX = (x: number) =>
            xOffset + (x - (bounds.minX - padding)) * scale;
          const getMMY = (y: number) =>
            yOffset + (y - (bounds.minY - padding)) * scale;

          // Draw Combos
          ctx.fillStyle = this.theme === "dark" ? "#444" : "#ccc";
          combos.forEach((c) => {
            const pos = this.graph.getAbsolutePosition(c.id);
            if (pos) {
              const mx = getMMX(pos.x);
              const my = getMMY(pos.y);
              ctx.moveTo(mx + 2, my);
              ctx.arc(mx, my, 2, 0, Math.PI * 2);
            }
          });
          ctx.fill();

          // Draw Nodes
          ctx.beginPath();
          ctx.fillStyle = this.theme === "dark" ? "#666" : "#aaa";
          nodes.forEach((n) => {
            const pos = this.graph.getAbsolutePosition(n.id);
            if (pos) {
              const mx = getMMX(pos.x);
              const my = getMMY(pos.y);
              ctx.moveTo(mx + 1, my);
              ctx.arc(mx, my, 1, 0, Math.PI * 2);
            }
          });
          ctx.fill();

          ctx.fillStrokeShape(shape);
        },
      });
      this.minimapContentGroup.add(dotsShape);

      this.lastRenderedMinimapTimestamp = Date.now();
    }

    // Viewport rectangle - always redraw this as it changes frequently
    let vpRect = this.minimapLayer.findOne("#viewport-rect") as Konva.Rect;
    if (!vpRect) {
      vpRect = new Konva.Rect({
        id: "viewport-rect",
        stroke: "#3b82f6",
        strokeWidth: 1,
        fill: "rgba(59, 130, 246, 0.1)",
      });
      this.minimapLayer.add(vpRect);
    }
    // Always move to top to stay above content
    vpRect.moveToTop();

    const getMMX = (x: number) =>
      xOffset + (x - (bounds.minX - padding)) * scale;
    const getMMY = (y: number) =>
      yOffset + (y - (bounds.minY - padding)) * scale;

    const stageX = -this.stage.x() / this.stage.scaleX();
    const stageY = -this.stage.y() / this.stage.scaleX();
    const stageW = this.stage.width() / this.stage.scaleX();
    const stageH = this.stage.height() / this.stage.scaleX();

    const vpX = getMMX(stageX);
    const vpY = getMMY(stageY);
    const vpW = stageW * scale;
    const vpH = stageH * scale;

    // Clip viewport rect to minimap bounds
    const rectX = Math.max(xOffset, vpX);
    const rectY = Math.max(yOffset, vpY);
    const rectW = Math.min(mmWidth - (rectX - xOffset), vpW - (rectX - vpX));
    const rectH = Math.min(mmHeight - (rectY - yOffset), vpH - (rectY - vpY));

    if (rectW > 0 && rectH > 0) {
      vpRect.show();
      vpRect.position({ x: rectX, y: rectY });
      vpRect.size({ width: rectW, height: rectH });
    } else {
      vpRect.hide();
    }

    this.minimapLayer.batchDraw();
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
        this.requestMinimapRender();
        break;
      case "node-drag-move":
        this.updateEdges(params.edgeIds);
        this.requestMinimapRender();
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
      registerItem: (id, item) => {
        this.items.set(id, item);
        if (item instanceof Konva.Group && item.id() === id) {
          if (this.graph.getCombo(id)) {
            this.combos.set(id, item);
          } else if (this.graph.getNode(id)) {
            const circle = item.findOne("Circle") as Konva.Circle;
            if (circle) {
              this.nodes.set(id, circle);
            }
          }
        } else if (item instanceof Konva.Arrow) {
          this.edges.set(id, item);
        }
      },
      hasGitChanges:
        Object.values(this.graph.getCurCombos()).some(
          (c: GraphCombo) => !!c.gitStatus,
        ) ||
        Object.values(this.graph.getCurNodes()).some(
          (n: GraphNode) => !!n.gitStatus,
        ),
      stage: this.stage,
      theme: this.theme,
      customColors: this.customColors,
    };

    // Handle children visibility/creation
    if (combo.collapsed) {
      // Collapsing: Remove children immediately
      contentGroup.destroyChildren();

      // Fill color immediately when collapsing
      circle.fill(combo.getFillColor(context));
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
        circle.fill(
          combo.collapsed ? combo.getFillColor(context) : "transparent",
        );
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
    this.requestMinimapRender();
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
      registerItem: (id, item) => {
        this.items.set(id, item);
        if (item instanceof Konva.Group && item.id() === id) {
          // Check if it's a combo group (it has a bg circle usually)
          // Actually, we can check the graph data
          if (this.graph.getCombo(id)) {
            this.combos.set(id, item);
          } else if (this.graph.getNode(id)) {
            const circle = item.findOne("Circle") as Konva.Circle;
            if (circle) {
              this.nodes.set(id, circle);
            }
          }
        } else if (item instanceof Konva.Arrow) {
          this.edges.set(id, item);
        }
      },
      hasGitChanges,
      stage: this.stage,
      theme: this.theme,
      customColors: this.customColors,
    };

    // Render Edges first (bottom)
    for (const edge of Object.values(edges)) {
      edge.render(context, this.layer);
    }

    // Render Combos
    for (const combo of Object.values(combos)) {
      combo.render(context, this.layer);
    }

    // Render Nodes
    for (const node of Object.values(nodes)) {
      node.render(context, this.layer);
    }

    this.layer.batchDraw();
    this.requestMinimapRender();
  }

  setTheme(theme: "dark" | "light") {
    this.theme = theme;
    this.render();
  }

  setCustomColors(colors: CustomColors) {
    this.customColors = colors;
    this.render();
  }
}
