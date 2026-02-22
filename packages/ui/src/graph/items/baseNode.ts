import type {
  ComponentInfoRender,
  PropData,
  TypeData,
  TypeDataParam,
  VariableLoc,
  VariableName,
  VariableScope,
} from "shared";
import Konva from "konva";
import type { LabelData } from "../label";
import type { GraphCombo } from "./combo";
import type {
  BaseNodeData,
  GraphItemPosition,
  Renderable,
  RenderContext,
} from ".";

export abstract class BaseNode implements Renderable {
  id: string;
  x: number;
  y: number;
  radius: number;
  scale: number;
  parent?: GraphCombo;
  gitStatus?: "added" | "modified" | "deleted";
  visible: boolean = true;
  combo?: string;
  name: VariableName;
  fileName: string;
  pureFileName?: string;
  label?: LabelData;
  color: string;
  highlighted: boolean = false;
  isLayoutCalculated: boolean = false;
  displayName?: string;

  // From DetailItemData
  scope?: VariableScope;
  loc?: VariableLoc;
  props?: PropData[];
  propData?: PropData;
  propType?: TypeData;
  type?:
    | "component"
    | "hook"
    | "type"
    | "interface"
    | "state"
    | "render"
    | "effect"
    | "memo"
    | "callback"
    | "ref"
    | "prop"
    | "jsx"
    | "normal"
    | (string & {});
  typeParams?: TypeDataParam[];
  extends?: string[];
  children?: Record<string, ComponentInfoRender>;
  ui?: BaseNodeData["ui"];

  constructor(data: BaseNodeData) {
    this.id = data.id;
    this.x = data.x ?? 0;
    this.y = data.y ?? 0;
    this.radius = data.radius ?? 20;
    this.scale = data.scale ?? 1;
    this.parent = data.parent;
    this.gitStatus = data.gitStatus;
    this.visible = data.visible ?? true;
    this.combo = data.combo;
    this.name = data.name;
    this.fileName = data.fileName ?? "";
    this.pureFileName = data.pureFileName;
    this.label = data.label;
    this.color = data.color ?? "blue";
    this.highlighted = data.highlighted ?? false;
    this.isLayoutCalculated = data.isLayoutCalculated ?? false;
    this.displayName = data.displayName;

    this.scope = data.scope;
    this.loc = data.loc;
    this.props = data.props;
    this.propData = data.propData;
    this.propType = data.propType;
    this.type = data.type;
    this.typeParams = data.typeParams;
    this.extends = data.extends;
    this.children = data.children;
    this.ui = data.ui;
  }

  abstract render(
    context: RenderContext,
    parent: Konva.Container,
  ): Konva.Group | Konva.Arrow;

  abstract getFillColor(context: RenderContext): string;

  protected renderLabel(
    group: Konva.Group,
    offsetY: number,
    context: RenderContext,
  ) {
    if (!this.label) return;

    const text = new Konva.Text({
      id: `label-${this.id}`,
      text: this.label.text,
      fill:
        this.label.fill ||
        context.customColors?.labelColor ||
        (context.theme === "dark" ? "white" : "black"),
      fontSize: 12 * this.scale,
      align: "center",
      y: offsetY,
    });

    text.offsetX(text.width() / 2);
    group.add(text);
  }

  protected renderGitStatus(
    group: Konva.Group,
    radius: number,
    indicatorSize: number = 4,
    context: RenderContext,
  ) {
    if (!this.gitStatus) return;

    const statusColor =
      this.gitStatus === "added"
        ? context.customColors?.gitAdded || "#22c55e"
        : this.gitStatus === "modified"
          ? context.customColors?.gitModified || "#f59e0b"
          : context.customColors?.gitDeleted || "#ef4444";

    const indicator = new Konva.Circle({
      id: `git-status-${this.id}`,
      x: radius * 0.7,
      y: -radius * 0.7,
      radius: indicatorSize * this.scale,
      fill: statusColor,
      stroke: "white",
      strokeWidth: 1 * this.scale,
    });
    group.add(indicator);
  }

  getAbsolutePosition(): GraphItemPosition {
    let ax = this.x;
    let ay = this.y;
    let p = this.parent;
    while (p) {
      ax += p.x;
      ay += p.y;
      p = p.parent;
    }
    return { x: ax, y: ay };
  }
}
