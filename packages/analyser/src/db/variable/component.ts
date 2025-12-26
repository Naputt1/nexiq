import type {
  ComponentFileVarComponent,
  ComponentInfoRender,
  VariableScope,
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

  constructor({
    id,
    name,
    dependencies,
    loc,
    ...options
  }: Omit<ComponentFileVarComponent, "isComponent">) {
    const scope = options.type === "function" ? options.scope : undefined;
    super(id, name, options.type, dependencies, true, loc, scope);
    this.file = options.file;
    this.componentType = options.componentType;
    this.states = options.states;
    this.hooks = options.hooks;
    this.props = options.props;
    this.contexts = options.contexts;
    this.renders = options.renders;
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
    };
  }
}
