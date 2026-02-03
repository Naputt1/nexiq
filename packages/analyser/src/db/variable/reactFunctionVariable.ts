import type {
  ComponentFileVarReact2,
  ComponentFileVarReactFunction,
  EffectInfo,
  Memo,
  PropData,
  ReactDependency,
  ReactFunctionVar,
  State,
} from "shared";
import { newUUID } from "../../utils/uuid.js";
import { BaseFunctionVariable } from "./baseFunctionVariable.js";
import type { File } from "../fileDB.js";
import { StateVariable } from "./state.js";
import { isMemoVariable, isStateVariable } from "./type.js";
import { MemoVariable } from "./memo.js";

export abstract class ReactFunctionVariable<
  TKind extends ReactFunctionVar = ReactFunctionVar,
> extends BaseFunctionVariable<TKind> {
  states: Set<string> = new Set();
  memos: Set<string> = new Set();
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

  public addMemo(memo: Omit<Memo, "id">): MemoVariable {
    const id = newUUID();

    this.resolveReactDependencies(memo.reactDeps);

    const memoVariablle = new MemoVariable(
      {
        id: id,
        name: memo.value,
        dependencies: {},
        ...memo,
      },
      this.file,
    );

    this.var.set(id, memoVariablle);
    this.memos.add(id);

    return memoVariablle;
  }

  public addHook(hook: string) {
    this.hooks.push(hook);
  }

  public resolveReactDependencies(reactDeps: ReactDependency[]) {
    outer: for (const dep of reactDeps) {
      for (const stateID of this.states) {
        const state = this.var.get(stateID);
        if (state == null || !isStateVariable(state)) continue;

        if (state.value === dep.name || state.setter === dep.name) {
          dep.id = state.id;
          continue outer;
        }
      }

      for (const memoID of this.memos) {
        const memo = this.var.get(memoID);
        if (memo == null || !isMemoVariable(memo)) continue;

        if (memo.name === dep.name) {
          dep.id = memo.id;
          continue outer;
        }
      }

      for (const prop of this.props) {
        if (prop.name == dep.name) {
          // TODO: add id to props
          // dep.id = prop.id;
          continue outer;
        }
      }

      debugger;
    }
  }

  public addEffect(effect: Omit<EffectInfo, "id">) {
    this.resolveReactDependencies(effect.reactDeps);

    const id = newUUID();
    this.effects[id] = {
      id,
      ...effect,
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
