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

  private items = new Map<string, Konva.Group | Konva.Circle | Konva.Arrow>();
  private edges = new Map<string, Konva.Arrow>();
  private combos = new Map<string, Konva.Group>();
  private nodes = new Map<string, Konva.Circle>();

  private bindId: string | null = null;

  constructor(
    container: HTMLDivElement,
    graph: GraphData,
    width: number,
    height: number,
    onSelect?: (id: string) => void,
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

    this.setupStageEvents();
    this.bindId = this.graph.bind(this.handleGraphEvent.bind(this));
    
    // Initial render
    this.render();
  }

  destroy() {
    if (this.bindId) {
      this.graph.unbind(this.bindId);
    }
    this.stage.destroy();
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
    });

    stage.on("mouseenter", () => (stage.container().style.cursor = "grab"));
    stage.on("mousedown", () => (stage.container().style.cursor = "grabbing"));
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
      case "combo-radius-change":
        this.handleComboRadiusChange(params.id, params.edgeIds);
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

    const startRadius = circle.radius();
    const targetRadius = combo.collapsed ? combo.collapsedRadius : combo.expandedRadius;

    // Handle children visibility
    if (combo.collapsed) {
        // Collapsing: Remove children immediately (except bg and label)
        // We identify children by not being bg or label
        const children = group.getChildren().slice();
        for (const child of children) {
            if (child.id() === `bg-${id}` || child instanceof Konva.Text) continue;
            child.destroy();
        }
    } else {
        // Expanding: Render children
        if (combo.child) {
            this.renderEdges(combo.child.edges, group);
            for (const sub of Object.values(combo.child.combos)) {
                this.renderCombo(sub, group);
            }
            for (const node of Object.values(combo.child.nodes)) {
                this.renderNode(node, group);
            }
        }
    }
    
    // Animate radius
    // We manually tween to trigger graph updates
    const anim = new Konva.Animation((frame) => {
        if (!frame) return;
        const duration = 300; // ms
        const time = Math.min(frame.time, duration);
        const rate = time / duration;
        // EaseInOut
        const t = rate < .5 ? 2 * rate * rate : -1 + (4 - 2 * rate) * rate;
        
        const currentR = startRadius + (targetRadius - startRadius) * t;
        
        circle.radius(currentR);
        this.graph.comboRadiusChange(id, currentR);
        
        // Label position? 
        const label = group.findOne('Text') as Konva.Text;
        if (label) {
             label.y(currentR + 10);
        }

        if (time >= duration) {
            anim.stop();
        }
    }, this.layer);
    
    anim.start();
  }

  private handleComboDragMove(_id: string, edgeIds: string[]) {
    // The combo group position is already updated by the drag event
    // We just need to update the edges
    this.updateEdges(edgeIds);
  }

  private handleComboRadiusChange(id: string, edgeIds: string[]) {
    const combo = this.graph.getCombo(id) || this.findComboRecursive(id);
    if (!combo) return;
    
    // We might need to animate radius change here or just re-render
    // For now, let's just re-render or update specific combo
    // Optimization: find the circle and tween radius
    
    const group = this.combos.get(id);
    if (!group) return; // Should be in map
    
    const circle = group.findOne(`#bg-${id}`) as Konva.Circle;
    if (circle) {
       new Konva.Tween({
         node: circle,
         radius: combo.collapsed ? combo.collapsedRadius : combo.expandedRadius,
         duration: 0.3,
       }).play();
    }
    
    // Update clip func if needed?
    // Re-rendering children if expanded/collapsed is handled by "new-combos" usually triggerd
    // But specific radius change:
    
    this.updateEdges(edgeIds);
  }

  private updateEdges(edgeIds: string[]) {
    for (const eid of edgeIds) {
      const edgeData = this.graph.getEdge(eid) || this.findEdgeRecursive(eid);
      const arrow = this.edges.get(eid);
      if (edgeData && arrow) {
        arrow.points(edgeData.points);
      }
    }
  }
  
  // Helper to find deep items if they are not in top level
  private findComboRecursive(id: string): ComboGraphData | undefined {
     // Placeholder
     if (id) return undefined;
     return undefined; 
  }
  
  private findEdgeRecursive(id: string): EdgeGraphData | undefined {
      // Placeholder
      if (id) return undefined;
      return undefined; 
  }

  render() {
    // For simplicity - clear and rebuild. 
    // Optimization: Diffing.
    // Given the request is for performance, we should avoid full rebuilds on every small change.
    // However, "new-nodes" usually implies structural change.
    
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

  private renderEdges(edges: Record<string, EdgeGraphData>, parent?: Konva.Group) {
     for (const edge of Object.values(edges)) {
        const arrow = new Konva.Arrow({
            id: edge.id,
            points: edge.points,
            fill: "#424242",
            stroke: "#666666",
            strokeWidth: 0.5,
            lineJoin: "round",
            perfectDrawEnabled: false,
            listening: false 
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

    // Background Circle
    const radius = combo.collapsed ? combo.collapsedRadius : combo.expandedRadius;
    const bg = new Konva.Circle({
        id: `bg-${combo.id}`,
        radius: radius,
        stroke: combo.color,
        strokeWidth: 4,
        fill: combo.collapsed ? combo.color : "transparent",
        perfectDrawEnabled: false
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

    // If not collapsed, render children
    if (!combo.collapsed) {
        // Children are in combo.child
        if (combo.child) {
            this.renderEdges(combo.child.edges, group);
            
            for (const sub of Object.values(combo.child.combos)) {
                this.renderCombo(sub, group);
            }
            for (const node of Object.values(combo.child.nodes)) {
                this.renderNode(node, group);
            }
        }
    }

    // Label
    this.renderLabel(combo, group, radius + 10);

    parent.add(group);
    this.combos.set(combo.id, group);
    this.items.set(combo.id, group);
  }

  private renderLabel(item: ComboGraphData | NodeGraphData, group: Konva.Group, offsetY: number) {
    if (!item.label) return;

    const text = new Konva.Text({
      text: item.label.text,
      fill: item.label.fill || "black",
      fontSize: 12, // Default font size
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
      perfectDrawEnabled: false,
    });
    
    group.add(circle);
    
    if (node.label) {
        this.renderLabel(node, group, (node.radius || 0) + 10);
    }

    parent.add(group);
    this.nodes.set(node.id, circle); // We might want to track the group instead?
    // tracking group for position updates
    // But items map might need to track group.
    this.items.set(node.id, group);
  }
}
