import type {
  ComponentFileVarReactWithCallback,
  ReactDependency,
  ReactWithCallbackVar,
  VarType,
} from "@nexiq/shared";
import { BaseFunctionVariable } from "./baseFunctionVariable.ts";
import type { File } from "../fileDB.ts";

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

  public load(data: ReactWithCallbackVariable<TKind, TType>) {
    super.load(data);

    this.reactDeps = data.reactDeps ? [...data.reactDeps] : this.reactDeps;
  }

  protected getBaseData(): ComponentFileVarReactWithCallback<TKind, TType> {
    return {
      ...super.getBaseData(),
      reactDeps: this.reactDeps,
    };
  }
}
