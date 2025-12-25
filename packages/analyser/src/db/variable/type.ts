import type { ComponentVariable } from "./component.js";
import type { Variable } from "./variable.js";
import type { DataVariable } from "./dataVariable.js";

export function isComponentVariable(v: Variable): v is ComponentVariable {
  return v.isComponent === true;
}

export function isDataVariable(v: Variable): v is DataVariable {
  return v.isComponent === false;
}
