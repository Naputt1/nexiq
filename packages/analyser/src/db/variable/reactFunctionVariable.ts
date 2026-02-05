import type {
  ComponentFileVarReact2,
  ComponentFileVarReactFunction,
  EffectInfo,
  Memo,
  PropData,
  ReactDependency,
  ReactFunctionVar,
  RefData,
  State,
} from "shared";
import { newUUID } from "../../utils/uuid.js";
import { BaseFunctionVariable } from "./baseFunctionVariable.js";
import type { File } from "../fileDB.js";
import { StateVariable } from "./stateVariable.js";
import { isMemoVariable, isRefVariable, isStateVariable } from "./type.js";
import { MemoVariable } from "./memo.js";
import { RefVariable } from "./refVariable.js";

export abstract class ReactFunctionVariable<
  TKind extends ReactFunctionVar = ReactFunctionVar,
> extends BaseFunctionVariable<TKind> {
  states: Set<string> = new Set();
  memos: Set<string> = new Set();
  refs: Set<string> = new Set();
  props: PropData[];
  hooks: string[];
  effects: Record<string, EffectInfo>;

  private stateCache: Record<string, string> = {};
  private refCache: Record<string, string> = {};

  constructor(
    options: Omit<
      ComponentFileVarReact2<TKind>,
      "var" | "components" | "type"
    >,
    file: File,
  ) {
    super(options, file);

    this.props = options.props;
    this.effects = options.effects;
    this.hooks = options.hooks;
    if (options.states) {
      this.states = new Set(options.states);
    }
  }

  public addState(state: Omit<State, "id">) {
    let id: string;
    if (state.value in this.stateCache) {
      id = this.stateCache[state.value]!;
      delete this.stateCache[state.value];
    } else {
      id = newUUID();
    }

    this.var.add(
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

  public addRef(ref: Omit<RefData, "id">): RefVariable {
    let id: string;
    if (ref.value in this.refCache) {
      id = this.refCache[ref.value]!;
      delete this.refCache[ref.value];
    } else {
      id = newUUID();
    }

    const refVariable = new RefVariable(
      {
        id: id,
        name: ref.value,
        dependencies: {},
        ...ref,
      },
      this.file,
    );

    this.var.add(refVariable);
    this.refs.add(id);

    return refVariable;
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

    this.var.add(memoVariablle);
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

      for (const refID of this.refs) {
        const ref = this.var.get(refID);
        if (ref == null || !isRefVariable(ref)) continue;

        if (ref.name === dep.name) {
          dep.id = ref.id;
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

  public syncSets() {
    this.states.clear();
    this.memos.clear();
    this.refs.clear();
    this.stateCache = {};
    this.refCache = {};

    for (const variable of this.var.values()) {
      if (isStateVariable(variable)) {
        this.states.add(variable.id);
        this.stateCache[variable.name] = variable.id;
      } else if (isMemoVariable(variable)) {
        this.memos.add(variable.id);
      } else if (isRefVariable(variable)) {
        this.refs.add(variable.id);
        this.refCache[variable.name] = variable.id;
      }
    }
  }

  public load(data: ReactFunctionVariable<TKind>) {
    super.load(data);
    this.syncSets();
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
