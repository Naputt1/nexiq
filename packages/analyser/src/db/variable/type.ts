import type { ComponentVariable } from "./component.js";
import type { Variable } from "./variable.js";
import type { DataVariable } from "./dataVariable.js";
import type { HookVariable } from "./hook.js";
import type { BaseFunctionVariable } from "./baseFunctionVariable.js";
import type { ReactFunctionVariable } from "./reactFunctionVariable.js";
import type { VarKind, VarType } from "@react-map/shared";
import type { StateVariable } from "./stateVariable.js";
import type { MemoVariable } from "./memo.js";
import type { RefVariable } from "./refVariable.js";
import type { CallHookVariable } from "./callHookVariable.js";
import type { JSXVariable } from "./jsx.js";
import { CallbackVariable } from "./callbackVariable.js";

export function isComponentVariable(v: Variable): v is ComponentVariable {
  return v.kind === "component" && (v.type === "function" || v.type === "class");
}

export function isJSXVariable(v: Variable): v is JSXVariable {
  return v.type === "jsx";
}

export function isHookVariable(v: Variable): v is HookVariable {
  return v.kind === "hook" && v.type === "function";
}

export function isCallHookVariable(v: Variable): v is CallHookVariable {
  return v.kind === "hook" && v.type === "data";
}

export function isReactFunctionVariable(
  v: Variable,
): v is ReactFunctionVariable {
  return isComponentVariable(v) || isHookVariable(v);
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
  return v.type === "data" && v.kind === "state";
}

export function isMemoVariable(v: Variable): v is MemoVariable {
  return v.type === "function" && v.kind === "memo";
}

export function isCallbackVariable(v: Variable): v is CallbackVariable {
  return v.type === "function" && v.kind === "callback";
}

export function isRefVariable(v: Variable): v is RefVariable {
  return v.type === "data" && v.kind === "ref";
}
