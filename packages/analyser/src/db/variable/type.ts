import type {
  ComponentVariable,
  ClassComponentVariable,
  FunctionComponentVariable,
} from "./component.ts";
import type { Variable } from "./variable.ts";
import type { DataVariable } from "./dataVariable.ts";
import type { MethodVariable } from "./methodVariable.ts";
import type { PropertyVariable } from "./propertyVariable.ts";
import type { HookVariable } from "./hook.ts";
import type { BaseFunctionVariable } from "./baseFunctionVariable.ts";
import type { ReactFunctionVariable } from "./reactFunctionVariable.ts";
import type { VarKind, VarType } from "@nexiq/shared";
import type { StateVariable } from "./stateVariable.ts";
import type { MemoVariable } from "./memo.ts";
import type { RefVariable } from "./refVariable.ts";
import type { CallHookVariable } from "./callHookVariable.ts";
import type { JSXVariable } from "./jsx.ts";
import type { CallbackVariable } from "./callbackVariable.ts";
import type { ClassVariable } from "./classVariable.ts";
import type { Scope } from "./scope.ts";

import {
  isComponentVariable as _isComponentVariable,
  isHookVariable as _isHookVariable,
  isMemoVariable as _isMemoVariable,
  isCallbackVariable as _isCallbackVariable,
  isReactFunctionVariable as _isReactFunctionVariable,
  isStateVariable as _isStateVariable,
  isRefVariable as _isRefVariable,
} from "./guards.ts";

export function isComponentVariable(v: Variable): v is ComponentVariable {
  return _isComponentVariable(v);
}

export function isClassComponentVariable(
  v: Variable,
): v is ClassComponentVariable {
  return _isComponentVariable(v) && v.type === "class";
}

export function isFunctionComponentVariable(
  v: Variable,
): v is FunctionComponentVariable {
  return _isComponentVariable(v) && v.type === "function";
}

export function isClassVariable(
  v: Variable,
): v is ClassVariable | ClassComponentVariable {
  return (
    (v.kind === "class" && v.type === "data") || isClassComponentVariable(v)
  );
}

export function isMethodVariable(v: Variable): v is MethodVariable {
  return v.kind === "method" && v.type === "function";
}

export function isPropertyVariable(v: Variable): v is PropertyVariable {
  return v.kind === "property" && v.type === "data";
}

export function isJSXVariable(v: Variable): v is JSXVariable {
  return v.type === "jsx";
}

export function isHookVariable(v: Variable): v is HookVariable {
  return _isHookVariable(v);
}

export function isCallHookVariable(v: Variable): v is CallHookVariable {
  return v.kind === "hook" && v.type === "data";
}

export function isReactFunctionVariable(
  v: Variable,
): v is ReactFunctionVariable {
  return _isReactFunctionVariable(v);
}

export function isNormalVariable(v: Variable): v is DataVariable {
  return v.kind === "normal" && v.type === "data";
}

export function isBaseFunctionVariable<TKind extends VarKind>(
  v: Variable<VarType, TKind>,
): v is BaseFunctionVariable<TKind> {
  return v.type === "function" || v.type === "class";
}

export function isDataVariable(v: Variable): v is DataVariable {
  return v.type === "data";
}

export function isStateVariable(v: Variable): v is StateVariable {
  return _isStateVariable(v);
}

export function isMemoVariable(v: Variable): v is MemoVariable {
  return _isMemoVariable(v);
}

export function isCallbackVariable(v: Variable): v is CallbackVariable {
  return _isCallbackVariable(v);
}

export function isRefVariable(v: Variable): v is RefVariable {
  return _isRefVariable(v);
}

export function isScope(v: Variable | Scope): v is Scope {
  return (v as Scope).type === "scope";
}
