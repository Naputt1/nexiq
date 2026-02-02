import type { ComponentVariable } from "./component.js";
import type { Variable } from "./variable.js";
import type { DataVariable } from "./dataVariable.js";
import type { HookVariable } from "./hook.js";
import type { FunctionVariable } from "./functionVariable.js";

export function isComponentVariable(v: Variable): v is ComponentVariable {
  return v.variableType === "component";
}

export function isHookVariable(v: Variable): v is HookVariable {
  return v.variableType === "hook";
}

export function isNormalVariable(v: Variable): v is DataVariable {
  return v.variableType === "normal";
}

export function isFunctionVariable(v: Variable): v is FunctionVariable {
  return v.type === "function";
}

export function isDataVariable(v: Variable): v is DataVariable {
  return v.type === "data";
}
