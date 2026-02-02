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

type InnerType = {
  found: boolean;
};

export abstract class ReactFunctionVariable<
  TKind extends ReactFunctionVar = ReactFunctionVar,
> extends BaseFunctionVariable<TKind> {
  states: Record<string, State & InnerType> = {};
  props: PropData[];
  hooks: string[];
  effects: Record<string, EffectInfo>;

  private stateCache: Record<string, State & InnerType> = {};

  constructor(
    options: Omit<ComponentFileVarReact2<TKind>, "var" | "components" | "type">,
    file: File,
  ) {
    super(options, file);

    for (const state of Object.values(options.states)) {
      this.states[state.id] = {
        ...state,
        found: false,
      };
      this.stateCache[state.value] = this.states[state.id]!;
    }

    this.props = options.props;
    this.effects = options.effects;
    this.hooks = options.hooks;
  }

  public addState(state: Omit<State, "id">) {
    let id: string;
    if (state.value in this.stateCache) {
      id = this.stateCache[state.value]!.id;
      delete this.stateCache[state.value];
    } else {
      id = newUUID();
    }

    this.states[id] = {
      id,
      ...state,
      found: true,
    };
  }

  public addHook(hook: string) {
    this.hooks.push(hook);
  }

  public addEffect(effect: Omit<EffectInfo, "id">) {
    const newDependencies: string[] = [];
    outer: for (const dep of effect.dependencies) {
      for (const state of Object.values(this.states)) {
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

    this.file = data.file;
  }

  protected getBaseData(): ComponentFileVarReactFunction<TKind> {
    return {
      ...super.getBaseData(),
      states: Object.fromEntries(
        Object.entries(this.states)
          .filter(([, state]) => state.found)
          .map(([key, { found: _, ...rest }]) => [key, rest]),
      ),
      props: this.props,
      hooks: this.hooks,
      effects: this.effects,
    };
  }
}
