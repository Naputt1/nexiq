import type {
  ComponentFileVarComponent,
  ComponentInfoRender,
  State,
} from "shared";
import { Variable } from "./variable.js";

export class ComponentVariable extends Variable {
  file: string;
  type: "Function" | "Class";
  states: State[];
  hooks: string[];
  props: string[];
  contexts: string[];
  renders: Record<string, ComponentInfoRender>;

  constructor({
    id,
    name,
    dependencies,
    ...options
  }: Omit<ComponentFileVarComponent, "isComponent">) {
    super(id, name, dependencies, true);
    this.file = options.file;
    this.type = options.type;
    this.states = options.states;
    this.hooks = options.hooks;
    this.props = options.props;
    this.contexts = options.contexts;
    this.renders = options.renders;
  }

  public getData(): ComponentFileVarComponent {
    return {
      id: this.id,
      name: this.name,
      isComponent: true,
      dependencies: this.dependencies,
      var: Object.fromEntries(
        Object.entries(Object.fromEntries(this.var)).map(([k, value]) => [
          k,
          value.getData(),
        ])
      ),
      file: this.file,
      type: this.type,
      states: this.states,
      hooks: this.hooks,
      props: this.props,
      contexts: this.contexts,
      renders: this.renders,
    };
  }
}
