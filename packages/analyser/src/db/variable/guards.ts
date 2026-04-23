import type { Variable } from "./variable.ts";

export function isComponentVariable(v: Variable): boolean {
  return v.kind === "component";
}

export function isHookVariable(v: Variable): boolean {
  return v.kind === "hook" && v.type === "function";
}

export function isMemoVariable(v: Variable): boolean {
  return v.type === "function" && v.kind === "memo";
}

export function isCallbackVariable(v: Variable): boolean {
  return v.type === "function" && v.kind === "callback";
}

export function isReactFunctionVariable(v: Variable): boolean {
  return (
    isComponentVariable(v) ||
    isHookVariable(v) ||
    isMemoVariable(v) ||
    isCallbackVariable(v)
  );
}

export function isStateVariable(v: Variable): boolean {
  return v.type === "data" && v.kind === "state";
}

export function isRefVariable(v: Variable): boolean {
  return v.type === "data" && v.kind === "ref";
}
