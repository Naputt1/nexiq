import type { ComponentVariable } from "./component.js";
import type { Variable } from "./variable.js";
import type { DataVariable } from "./dataVariable.js";
import type { HookVariable } from "./hook.js";
import type { BaseFunctionVariable } from "./baseFunctionVariable.js";
import type { VarKind, VarType } from "shared";
import type { StateVariable } from "./state.js";

export function isComponentVariable(v: Variable): v is ComponentVariable {
  return v.kind === "component";
}

export function isHookVariable(v: Variable): v is HookVariable {
  return v.kind === "hook";
}

export function isNormalVariable(v: Variable): v is DataVariable {
  return v.kind === "normal";
}

export function isBaseFunctionVariable<TKind extends VarKind>(
  v: Variable<VarType, TKind>,
): v is BaseFunctionVariable<TKind> {
  return v.type === "function";
}

export function isDataVariable(v: Variable): v is DataVariable {
  return v.type === "data";
}

export function isStateVariable(v: Variable): v is StateVariable {
  return v.type === "data" && v.kind === "state";
}
