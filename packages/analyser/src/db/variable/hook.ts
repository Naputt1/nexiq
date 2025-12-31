import type { ComponentFileVarHook, EffectInfo, PropData, State } from "shared";
import { Variable } from "./variable.js";

export class HookVariable extends Variable {
  file: string;
  states: Record<string, State>;
  props: PropData[];
  hooks: string[];
  effects: Record<string, EffectInfo>;

  constructor({
    id,
    name,
    dependencies,
    loc,
    ...options
  }: Omit<ComponentFileVarHook, "variableType" | "var" | "components">) {
    const scope = options.type === "function" ? options.scope : undefined;
    super(id, name, options.type, dependencies, "hook", loc, scope);
    this.file = options.file;
    this.states = options.states;
    this.props = options.props;
    this.effects = options.effects;
    this.hooks = options.hooks;
  }

  public getData(): ComponentFileVarHook {
    return {
      ...super.getBaseData(),
      file: this.file,
      variableType: "hook",
      loc: this.loc,
      states: this.states,
      props: this.props,
      effects: this.effects,
      hooks: this.hooks,
    };
  }
}
