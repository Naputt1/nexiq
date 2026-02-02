import type {
  ComponentFileVarReactWithCallback,
  ReactDependency,
  ReactWithCallbackVar,
} from "shared";
import { BaseFunctionVariable } from "./baseFunctionVariable.js";
import type { File } from "../fileDB.js";

export abstract class ReactWithCallbackVariable<
  TKind extends ReactWithCallbackVar = ReactWithCallbackVar,
> extends BaseFunctionVariable<TKind> {
  reactDeps: ReactDependency[];

  constructor(
    options: Omit<
      ComponentFileVarReactWithCallback<TKind>,
      "var" | "components" | "type"
    >,
    file: File,
  ) {
    super(options, file);

    this.reactDeps = options.reactDeps;
  }

  public load(data: ReactWithCallbackVariable<TKind>) {
    super.load(data);

    this.file = data.file;
  }

  protected getBaseData(): ComponentFileVarReactWithCallback<TKind> {
    return {
      ...super.getBaseData(),
      reactDeps: this.reactDeps,
    };
  }
}
