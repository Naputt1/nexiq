import type {
  ComponentFileVarReactFunction,
  EffectInfo,
  Memo,
  PropData,
  PropDataType,
  ReactDependency,
  ReactVarKind,
  RefData,
  TypeDataRef,
  VariableName,
  VarType,
  HookMetadata,
  DBBatch,
} from "@nexiq/shared";
import { BaseFunctionVariable } from "./baseFunctionVariable.ts";
import type { File } from "../fileDB.ts";
import { StateVariable } from "./stateVariable.ts";
import {
  isCallbackVariable,
  isMemoVariable,
  isRefVariable,
  isStateVariable,
} from "./type.ts";
import type { MemoVariable } from "./memo.ts";
import type { CallbackVariable } from "./callbackVariable.ts";
import { RefVariable } from "./refVariable.ts";
import { VariableRegistry } from "./registry.ts";
import { getVariableNameKey } from "../../analyzer/pattern.ts";
import { CallHookVariable } from "./callHookVariable.ts";

export abstract class ReactFunctionVariable<
  TKind extends ReactVarKind = ReactVarKind,
  TType extends VarType = "function",
> extends BaseFunctionVariable<TKind, TType> {
  states: Set<string> = new Set();
  memos: Set<string> = new Set();
  callbacks: Set<string> = new Set();
  refs: Set<string> = new Set();
  props: PropData[];
  propName?: string | undefined;
  hooks: string[];
  effects: Record<string, EffectInfo>;

  private stateCache: Record<string, string> = {};
  private refCache: Record<string, string> = {};

  constructor(
    options: Omit<
      ComponentFileVarReactFunction<TKind, TType>,
      "var" | "components" | "hash" | "file"
    >,
    file: File,
  ) {
    super(options, file);

    this.props = options.props;
    this.propName = options.propName;
    this.effects = options.effects;
    this.hooks = options.hooks;
    if (options.states) {
      this.states = new Set(options.states);
    }
  }

  public addState(
    state: Omit<
      Omit<
        ConstructorParameters<typeof StateVariable>[0],
        "id" | "dependencies"
      >,
      "id"
    > & { name: VariableName },
  ): string {
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

  public addCallHook(
    calHook: Omit<ConstructorParameters<typeof CallHookVariable>[0], "id">,
  ): string {
    const id = `${this.id}:callhook:${calHook.call.name}:${calHook.loc.line}:${calHook.loc.column}`;

    this.var.add(
      new CallHookVariable(
        {
          id,
          ...calHook,
        },
        this.file,
      ),
    );

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
      for (const prop of Object.values(defaultData.properties || {})) {
        this.resolveReactDefaultData(prop);
      }
    }
  }

  public addRef(
    ref: Omit<RefData, "id"> & { name: VariableName },
  ): RefVariable {
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

  public addMemo(
    memo: Omit<Memo, "id"> & { name: VariableName },
  ): MemoVariable {
    const nameKey = getVariableNameKey(memo.name);
    const id = `${this.id}:memo:${nameKey}`;

    this.resolveReactDependencies(memo.reactDeps);

    const memoVariablle = new VariableRegistry.MemoVariable!(
      {
        id,
        dependencies: {},
        states: [],
        refs: [],
        props: [],
        hooks: [],
        effects: {},
        ...memo,
      },
      this.file,
    );

    this.var.add(memoVariablle);
    this.memos.add(id);

    return memoVariablle;
  }

  public addCallback(
    callback: Omit<Memo, "id"> & { name: VariableName },
  ): CallbackVariable {
    const nameKey = getVariableNameKey(callback.name);
    const id = `${this.id}:callback:${nameKey}`;

    this.resolveReactDependencies(callback.reactDeps);

    const callbackVariablle = new VariableRegistry.CallbackVariable!(
      {
        id,
        dependencies: {},
        states: [],
        refs: [],
        props: [],
        hooks: [],
        effects: {},
        ...callback,
      },
      this.file,
    );

    this.var.add(callbackVariablle);
    this.callbacks.add(id);

    return callbackVariablle;
  }

  public addHook(hook: string) {
    if (!this.hooks.includes(hook)) {
      this.hooks.push(hook);
    }
  }

  public resolveReactDependencies(reactDeps: ReactDependency[]) {
    outer: for (const dep of reactDeps) {
      const baseName = dep.name.split(/[.[?]/)[0]!;

      for (const stateID of this.states) {
        const state = this.var.get(stateID);
        if (state == null || !isStateVariable(state)) continue;

        const stateNameKey = getVariableNameKey(state.name);
        if (
          stateNameKey === dep.name ||
          stateNameKey === baseName ||
          state.setter === dep.name
        ) {
          dep.id = state.id;
          continue outer;
        }
      }

      for (const memoID of this.memos) {
        const memo = this.var.get(memoID);
        if (memo == null || !isMemoVariable(memo)) continue;

        const memoNameKey = getVariableNameKey(memo.name);
        if (memoNameKey === dep.name || memoNameKey === baseName) {
          dep.id = memo.id;
          continue outer;
        }
      }

      for (const callbackID of this.callbacks) {
        const callback = this.var.get(callbackID);
        if (callback == null || !isCallbackVariable(callback)) continue;

        const callbackNameKey = getVariableNameKey(callback.name);
        if (callbackNameKey === dep.name || callbackNameKey === baseName) {
          dep.id = callback.id;
          continue outer;
        }
      }

      for (const refID of this.refs) {
        const ref = this.var.get(refID);
        if (ref == null || !isRefVariable(ref)) continue;

        const refNameKey = getVariableNameKey(ref.name);
        if (refNameKey === dep.name || refNameKey === baseName) {
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

      const prop =
        findProp(this.props, dep.name) ||
        findProp(this.props, baseName) ||
        (this.propName && dep.name.startsWith(this.propName + ".")
          ? findProp(this.props, dep.name.slice(this.propName.length + 1))
          : undefined);
      if (prop) {
        dep.id = prop.id;
        continue outer;
      }

      const depId =
        this.var.getIdByName(dep.name) || this.var.getIdByName(baseName);
      if (depId) {
        dep.id = depId;
        continue outer;
      }

      const dependency = Object.values(this.dependencies || {}).find(
        (d) => d.name === dep.name || d.name === baseName,
      );
      if (dependency) {
        dep.id = dependency.id;
        continue outer;
      }

      if (
        process.env.DEBUG ||
        process.env.FULL_DEBUG ||
        process.env.VITEST ||
        process.env.SNAPSHOT
      ) {
        if (this.file.import.has(dep.name) || this.file.import.has(baseName)) {
          continue outer;
        }
      }

      // debugger;
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
    this.callbacks.clear();
    this.refs.clear();
    this.stateCache = {};
    this.refCache = {};

    for (const variable of this.var.values()) {
      if (isStateVariable(variable)) {
        this.states.add(variable.id);
        this.stateCache[getVariableNameKey(variable.name)] = variable.id;
      } else if (isMemoVariable(variable)) {
        this.memos.add(variable.id);
      } else if (isCallbackVariable(variable)) {
        this.callbacks.add(variable.id);
      } else if (isRefVariable(variable)) {
        this.refs.add(variable.id);
        this.refCache[getVariableNameKey(variable.name)] = variable.id;
      }
    }
  }

  public load(data: Partial<ComponentFileVarReactFunction<TKind, TType>>) {
    super.load(data);

    this.propName = data.propName || this.propName;
    if (data.props && data.props.length > 0) {
      this.props = [...data.props];
    }
    if (data.hooks && data.hooks.length > 0) {
      this.hooks = [...data.hooks];
    }
    if (data.effects && Object.keys(data.effects).length > 0) {
      this.effects = { ...data.effects };
    }
    this.syncSets();
  }

  protected getBaseData(): ComponentFileVarReactFunction<TKind, TType> {
    return {
      ...super.getBaseData(),
      states: [...this.states],
      refs: [...this.refs],
      props: this.props,
      propName: this.propName,
      hooks: this.hooks,
      effects: this.effects,
    };
  }

  protected getMetadata(): HookMetadata {
    return {
      states: [...this.states],
      refs: [...this.refs],
      props: this.props,
      params: this.props, // Use props as params for now
      ...(this.async !== undefined ? { async: this.async } : {}),
      propName: this.propName,
      hooks: this.hooks,
      effects: this.effects,
    };
  }

  public override toDBRow(batch: DBBatch, scopeId: string): void {
    super.toDBRow(batch, scopeId);

    const innerScopeId = `scope:block:${this.id}`;

    const insertProp = (prop: PropData, pathSegments: string[] = []) => {
      batch.entities.add({
        id: prop.id,
        scope_id: innerScopeId,
        kind: "prop",
        name: prop.name,
        type: "data",
        line: prop.loc?.line ?? null,
        column: prop.loc?.column ?? null,
        end_line: null,
        end_column: null,
        declaration_kind: null,
        data_json: JSON.stringify({
          type: prop.type,
          kind: prop.kind,
          defaultValue: prop.defaultValue,
        }),
      });

      batch.symbols.add({
        id: `symbol:${prop.id}`,
        entity_id: prop.id,
        scope_id: innerScopeId,
        name: prop.name,
        path: pathSegments.length > 0 ? JSON.stringify(pathSegments) : null,
        is_alias: 0,
        has_default: 0,
        data_json: null,
      });

      for (const childProp of prop.props || []) {
        insertProp(childProp, [...pathSegments, childProp.name]);
      }
    };

    for (const prop of this.props) {
      insertProp(prop);
    }
  }
}
