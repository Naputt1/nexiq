import type {
  VariableScope,
  ComponentFileVarBaseTypeFunction,
  VarKind,
} from "shared";
import { Variable } from "./variable.js";
import type { File } from "../fileDB.js";
import { Scope } from "./scope.js";

export abstract class BaseFunctionVariable<
  TKind extends VarKind,
> extends Variable<"function", TKind> {
  var: Scope;
  scope: VariableScope;

  constructor(
    options: Omit<
      ComponentFileVarBaseTypeFunction<TKind>,
      "var" | "components" | "type" | "file" | "hash"
    >,
    file: File,
  ) {
    super({ ...options, type: "function" }, file);
    this.var = new Scope();
    this.scope = options.scope;
  }

  public load(data: BaseFunctionVariable<TKind>) {
    super.load(data);

    this.type = data.type;
    this.scope = data.scope;
  }

  protected getBaseData(): ComponentFileVarBaseTypeFunction<TKind> {
    return {
      ...super.getBaseData(),
      var: this.var.getData(),
      scope: this.scope,
    };
  }

  protected getDataInternal() {
    return {
      name: this.name,
      var: this.var.getData(),
      scope: this.scope,
    };
  }
}
