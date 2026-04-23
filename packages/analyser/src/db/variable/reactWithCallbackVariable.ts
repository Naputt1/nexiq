import type {
  ComponentFileVarReactWithCallback,
  ReactDependency,
  ReactWithCallbackVar,
  VarType,
} from "@nexiq/shared";
import { ReactFunctionVariable } from "./reactFunctionVariable.ts";
import type { File } from "../fileDB.ts";
import { isCallbackVariable, isMemoVariable } from "./type.ts";

export abstract class ReactWithCallbackVariable<
  TKind extends ReactWithCallbackVar = ReactWithCallbackVar,
  TType extends VarType = "function",
> extends ReactFunctionVariable<TKind, TType> {
  reactDeps: ReactDependency[];

  constructor(
    options: Omit<
      ComponentFileVarReactWithCallback<TKind, TType>,
      "var" | "components" | "file"
    >,
    file: File,
  ) {
    super(
      {
        ...options,
        states: [],
        hooks: [],
        effects: {},
        props: [],
        refs: [],
      },
      file,
    );

    this.reactDeps = options.reactDeps;
  }

  public load(data: ReactFunctionVariable<TKind, TType>) {
    super.load(data);

    if (isMemoVariable(data) || isCallbackVariable(data)) {
      this.reactDeps = data.reactDeps ? [...data.reactDeps] : this.reactDeps;
    }
  }

  protected getBaseData(): ComponentFileVarReactWithCallback<TKind, TType> {
    return {
      ...super.getBaseData(),
      reactDeps: this.reactDeps,
    };
  }
}
