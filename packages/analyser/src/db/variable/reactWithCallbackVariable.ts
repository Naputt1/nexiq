import type {
  ComponentFileVarReactWithCallback,
  ReactDependency,
  ReactWithCallbackVar,
  VarType,
  MemoMetadata,
  CallbackMetadata,
} from "@nexiq/shared";
import { ReactFunctionVariable } from "./reactFunctionVariable.ts";
import type { File } from "../fileDB.ts";

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

  public load(data: Partial<ComponentFileVarReactWithCallback<TKind, TType>>) {
    super.load(data);

    if (data.reactDeps) {
      this.reactDeps = [...data.reactDeps];
    }
  }
  protected getMetadata(): MemoMetadata | CallbackMetadata {
    return {
      ...super.getMetadata(),
      reactDeps: this.reactDeps,
      scope: this.scope,
      ...(this.async !== undefined ? { async: this.async } : {}),
    };
  }

  protected getBaseData(): ComponentFileVarReactWithCallback<TKind, TType> {
    return {
      ...super.getBaseData(),
      reactDeps: this.reactDeps,
    };
  }

  protected getDataInternal() {
    return {
      ...super.getDataInternal(),
      reactDeps: this.reactDeps,
    };
  }
}
