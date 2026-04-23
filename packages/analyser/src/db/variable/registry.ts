import type { MemoVariable } from "./memo.ts";
import type { CallbackVariable } from "./callbackVariable.ts";

type VariableRegistryType = {
  MemoVariable: typeof MemoVariable | null;
  CallbackVariable: typeof CallbackVariable | null;
};

export const VariableRegistry: VariableRegistryType = {
  MemoVariable: null,
  CallbackVariable: null,
};
