import type { ComponentVariable } from "./component.js";
import type { Variable } from "./variable.js";

export function isComponentVariable(v: Variable): v is ComponentVariable {
  return v.isComponent === true;
}

export function isDataVariable(v: Variable): v is ComponentVariable {
  return v.isComponent === false;
}
