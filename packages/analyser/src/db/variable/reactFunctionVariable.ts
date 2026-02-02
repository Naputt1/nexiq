import type {
  ComponentFileVarReact2,
  ComponentFileVarReactFunction,
  EffectInfo,
  PropData,
  ReactFunctionVar,
  State,
} from "shared";
import { newUUID } from "../../utils/uuid.js";
import { BaseFunctionVariable } from "./baseFunctionVariable.js";
import type { File } from "../fileDB.js";
import { StateVariable } from "./state.js";
import { isStateVariable } from "./type.js";

export abstract class ReactFunctionVariable<
  TKind extends ReactFunctionVar = ReactFunctionVar,
> extends BaseFunctionVariable<TKind> {
  states: Set<string> = new Set();
  props: PropData[];
  hooks: string[];
  effects: Record<string, EffectInfo>;

  private stateCache: Record<string, string> = {};

  constructor(
    options: Omit<
      ComponentFileVarReact2<TKind>,
      "var" | "components" | "type" | "states"
    >,
    file: File,
  ) {
    super(options, file);

    this.props = options.props;
    this.effects = options.effects;
    this.hooks = options.hooks;
  }

  public addState(state: Omit<State, "id">) {
    let id: string;
    if (state.value in this.stateCache) {
      id = this.stateCache[state.value]!;
      delete this.stateCache[state.value];
    } else {
      id = newUUID();
    }

    this.var.set(
      id,
      new StateVariable(
        {
          id: id,
          name: state.value,
          dependencies: {},
          ...state,
        },
        this.file,
      ),
    );

    this.states.add(id);
  }

  public addHook(hook: string) {
    this.hooks.push(hook);
  }

  public addEffect(effect: Omit<EffectInfo, "id">) {
    const newDependencies: string[] = [];
    outer: for (const dep of effect.dependencies) {
      for (const stateID of this.states) {
        const state = this.var.get(stateID);
        if (state == null || !isStateVariable(state)) continue;

        if (state.value === dep) {
          newDependencies.push(state.id);
          continue outer;
        }
      }

      for (const prop of this.props) {
        if (prop.name == dep) {
          newDependencies.push(dep);
          continue outer;
        }
      }

      debugger;
    }

    const id = newUUID();
    this.effects[id] = {
      id,
      ...effect,
      dependencies: newDependencies,
    };
  }

  public load(data: ReactFunctionVariable<TKind>) {
    super.load(data);

    for (const stateID of this.states) {
      const state = this.var.get(stateID);
      if (state == null || !isStateVariable(state)) continue;

      this.stateCache[state.value] = stateID;
    }
  }

  protected getBaseData(): ComponentFileVarReactFunction<TKind> {
    return {
      ...super.getBaseData(),
      states: [...this.states],
      props: this.props,
      hooks: this.hooks,
      effects: this.effects,
    };
  }
}
