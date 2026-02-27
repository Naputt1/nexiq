import type {
  ComponentFileVarReactWithCallback,
  ReactDependency,
  ReactWithCallbackVar,
  VarType,
} from "shared";
import { BaseFunctionVariable } from "./baseFunctionVariable.js";
import type { File } from "../fileDB.js";
import { Variable } from "./variable.js";

export abstract class ReactWithCallbackVariable<
  TKind extends ReactWithCallbackVar = ReactWithCallbackVar,
  TType extends VarType = "function",
> extends BaseFunctionVariable<TKind, TType> {
  reactDeps: ReactDependency[];

  constructor(
    options: Omit<
      ComponentFileVarReactWithCallback<TKind, TType>,
      "var" | "components" | "file"
    >,
    file: File,
  ) {
    super(options as any, file); // eslint-disable-line @typescript-eslint/no-explicit-any

    this.reactDeps = options.reactDeps;
  }

  public load(data: Variable<TType, TKind>) {
    super.load(data);

    if (data instanceof ReactWithCallbackVariable) {
      this.reactDeps = data.reactDeps;
    }
  }

  protected getBaseData(): ComponentFileVarReactWithCallback<TKind, TType> {
    return {
      ...super.getBaseData(),
      reactDeps: this.reactDeps,
    };
  }
}
