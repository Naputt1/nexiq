import type {
  ComponentFileVarComponent,
  ComponentInfoRender,
  EffectInfo,
  PropData,
  State,
} from "shared";
import { Variable } from "./variable.js";
import type { TypeData } from "shared/src/types/primitive.js";

export class ComponentVariable extends Variable {
  file: string;
  componentType: ComponentFileVarComponent["componentType"];
  states: Record<string, State>;
  hooks: string[];
  props: PropData[];
  propType: TypeData | undefined;
  effects: Record<string, EffectInfo>;
  contexts: string[];
  renders: Record<string, ComponentInfoRender>;

  constructor({
    id,
    name,
    dependencies,
    loc,
    ...options
  }: Omit<ComponentFileVarComponent, "variableType">) {
    const scope = options.type === "function" ? options.scope : undefined;
    super(id, name, options.type, dependencies, "component", loc, scope);
    this.file = options.file;
    this.componentType = options.componentType;
    this.states = options.states;
    this.hooks = options.hooks;
    this.props = options.props;
    this.propType = options.propType;
    this.effects = options.effects;
    this.contexts = options.contexts;
    this.renders = options.renders;
  }

  public getData(): ComponentFileVarComponent {
    const data: ComponentFileVarComponent = {
      ...super.getBaseData(),
      variableType: "component",
      file: this.file,
      componentType: this.componentType,
      states: this.states,
      hooks: this.hooks,
      props: this.props,
      effects: this.effects,
      contexts: this.contexts,
      renders: this.renders,
    };

    if (this.propType) {
      data.propType = this.propType;
    }

    return data;
  }
}
