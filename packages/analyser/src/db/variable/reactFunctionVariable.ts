import type {
  ComponentFileVarReactFunction,
  EffectInfo,
  Memo,
  PropData,
  PropDataType,
  ReactDependency,
  ReactFunctionVar,
  RefData,
  State,
  TypeDataRef,
  VariableName,
} from "shared";
import { BaseFunctionVariable } from "./baseFunctionVariable.js";
import type { File } from "../fileDB.js";
import { StateVariable } from "./stateVariable.js";
import { isMemoVariable, isRefVariable, isStateVariable } from "./type.js";
import { MemoVariable } from "./memo.js";
import { RefVariable } from "./refVariable.js";
import { getVariableNameKey } from "../../analyzer/pattern.js";

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
      ComponentFileVarReactFunction<TKind>,
      "var" | "components" | "type" | "hash" | "file"
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

  public addState(state: Omit<State, "id"> & { name: VariableName }): string {
    const nameKey = getVariableNameKey(state.name);
    const id = `${this.id}:state:${nameKey}`;

    this.var.add(
      new StateVariable(
        {
          id: id,
          dependencies: {},
          ...state,
        },
        this.file,
      ),
    );

    this.states.add(id);

    return id;
  }

  private __resolveReactDefaultDataProp(
    propData: PropData,
    defaultData: TypeDataRef,
  ): boolean {
    if (defaultData.refType === "named") {
      if (propData.name === defaultData.name) {
        defaultData.name = propData.id;
        return true;
      }
    } else {
      if (
        defaultData.names.length > 0 &&
        propData.name === defaultData.names[0]
      ) {
        defaultData.names[0] = propData.id;
        return true;
      }
    }

    return false;
  }

  private resolveReactDefaultData(defaultData: PropDataType) {
    if (defaultData.type === "ref") {
      const name =
        defaultData.refType === "named"
          ? defaultData.name
          : defaultData.names[0];

      if (name == null) return;

      for (const prop of this.props) {
        if (prop.props) {
          for (const innerProp of prop.props) {
            if (this.__resolveReactDefaultDataProp(innerProp, defaultData))
              return;
          }
        } else {
          if (this.__resolveReactDefaultDataProp(prop, defaultData)) return;
        }
      }

      for (const stateID of this.states) {
        const state = this.var.get(stateID);
        if (state == null || !isStateVariable(state)) continue;

        const stateNameKey = getVariableNameKey(state.name);
        if (stateNameKey === name || state.setter === name) {
          if (defaultData.refType === "named") {
            defaultData.name = stateID;
          } else {
            defaultData.names[0] = stateID;
          }
          return;
        }
      }

      for (const memoID of this.memos) {
        const memo = this.var.get(memoID);
        if (memo == null || !isMemoVariable(memo)) continue;

        const memoNameKey = getVariableNameKey(memo.name);
        if (memoNameKey === name) {
          if (defaultData.refType === "named") {
            defaultData.name = memoID;
          } else {
            defaultData.names[0] = memoID;
          }
          return;
        }
      }

      for (const refID of this.refs) {
        const ref = this.var.get(refID);
        if (ref == null || !isRefVariable(ref)) continue;

        const refNameKey = getVariableNameKey(ref.name);
        if (refNameKey === name) {
          if (defaultData.refType === "named") {
            defaultData.name = refID;
          } else {
            defaultData.names[0] = refID;
          }
          return;
        }
      }

      const v = this.var.getByName(name);
      if (v) {
        if (defaultData.refType === "named") {
          defaultData.name = v.id;
        } else {
          defaultData.names[0] = v.id;
        }
        return;
      }
    } else if (defaultData.type === "literal-array") {
      for (const element of defaultData.elements) {
        this.resolveReactDefaultData(element);
      }
    } else if (defaultData.type === "literal-object") {
      for (const prop of Object.values(defaultData.properties)) {
        this.resolveReactDefaultData(prop);
      }
    }
  }

  public addRef(ref: Omit<RefData, "id"> & { name: VariableName }): RefVariable {
    const nameKey = getVariableNameKey(ref.name);
    const id = `${this.id}:ref:${nameKey}`;

    this.resolveReactDefaultData(ref.defaultData);

    const refVariable = new RefVariable(
      {
        id: id,
        dependencies: {},
        ...ref,
      },
      this.file,
    );

    this.var.add(refVariable);
    this.refs.add(id);

    return refVariable;
  }

  public addMemo(memo: Omit<Memo, "id"> & { name: VariableName }): MemoVariable {
    const nameKey = getVariableNameKey(memo.name);
    const id = `${this.id}:memo:${nameKey}`;

    this.resolveReactDependencies(memo.reactDeps);

    const memoVariablle = new MemoVariable(
      {
        id: id,
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

        const stateNameKey = getVariableNameKey(state.name);
        if (stateNameKey === dep.name || state.setter === dep.name) {
          dep.id = state.id;
          continue outer;
        }
      }

      for (const memoID of this.memos) {
        const memo = this.var.get(memoID);
        if (memo == null || !isMemoVariable(memo)) continue;

        const memoNameKey = getVariableNameKey(memo.name);
        if (memoNameKey === dep.name) {
          dep.id = memo.id;
          continue outer;
        }
      }

      for (const refID of this.refs) {
        const ref = this.var.get(refID);
        if (ref == null || !isRefVariable(ref)) continue;

        const refNameKey = getVariableNameKey(ref.name);
        if (refNameKey === dep.name) {
          dep.id = ref.id;
          continue outer;
        }
      }

      const findProp = (
        props: PropData[],
        name: string,
      ): PropData | undefined => {
        for (const prop of props) {
          if (prop.name === name) return prop;
          if (prop.props) {
            const found = findProp(prop.props, name);
            if (found) return found;
          }
        }
        return undefined;
      };

      const prop = findProp(this.props, dep.name);
      if (prop) {
        dep.id = prop.id;
        continue outer;
      }

      const v = this.var.getByName(dep.name);
      if (v) {
        dep.id = v.id;
        continue outer;
      }

      const dependency = Object.values(this.dependencies).find(
        (d) => d.name === dep.name,
      );
      if (dependency) {
        dep.id = dependency.id;
        continue outer;
      }

      debugger;
    }
  }

  public addEffect(effect: Omit<EffectInfo, "id">) {
    this.resolveReactDependencies(effect.reactDeps);

    const id = `${this.id}:effect:${effect.loc.line}:${effect.loc.column}`;
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
        this.stateCache[getVariableNameKey(variable.name)] = variable.id;
      } else if (isMemoVariable(variable)) {
        this.memos.add(variable.id);
      } else if (isRefVariable(variable)) {
        this.refs.add(variable.id);
        this.refCache[getVariableNameKey(variable.name)] = variable.id;
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

  protected getDataInternal() {
    return {
      name: this.name,
      var: this.var.getData(),
      scope: this.scope,
      states: [...this.states],
      props: this.props,
      hooks: this.hooks,
      effects: this.effects,
    };
  }
}
