import type {
  ComponentFileVarComponent,
  ComponentInfoRender,
  State,
} from "shared";
import { Variable } from "./variable.js";

export class ComponentVariable extends Variable {
  file: string;
  componentType: ComponentFileVarComponent["componentType"];
  states: State[];
  hooks: string[];
  props: string[];
  contexts: string[];
  renders: Record<string, ComponentInfoRender>;
  isHook: boolean = false;

  constructor({
    id,
    name,
    dependencies,
    loc,
    isHook = false,
    ...options
  }: Omit<ComponentFileVarComponent, "isComponent" | "isHook"> & {
    isHook?: boolean;
  }) {
    const scope = options.type === "function" ? options.scope : undefined;
    super(id, name, options.type, dependencies, true, loc, scope);
    this.file = options.file;
    this.componentType = options.componentType;
    this.states = options.states;
    this.hooks = options.hooks;
    this.props = options.props;
    this.contexts = options.contexts;
    this.renders = options.renders;
    this.isHook = isHook;
  }

  public getData(): ComponentFileVarComponent {
    return {
      ...super.getBaseData(),
      isComponent: true,
      file: this.file,
      componentType: this.componentType,
      states: this.states,
      hooks: this.hooks,
      props: this.props,
      contexts: this.contexts,
      renders: this.renders,
      isHook: this.isHook,
    };
  }
}
