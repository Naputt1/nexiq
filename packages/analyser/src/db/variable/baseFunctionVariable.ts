import type {
  VariableScope,
  ComponentFileVarBaseTypeFunction,
  VarKind,
} from "shared";
import { Variable } from "./variable.js";
import type { File } from "../fileDB.js";

export abstract class BaseFunctionVariable<
  TKind extends VarKind,
> extends Variable<"function", TKind> {
  var: Map<string, Variable>;
  scope: VariableScope;

  constructor(
    options: Omit<
      ComponentFileVarBaseTypeFunction<TKind>,
      "var" | "components" | "type" | "file"
    >,
    file: File,
  ) {
    super({ ...options, type: "function" }, file);
    this.var = new Map();
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
      var: Object.fromEntries(
        Object.entries(Object.fromEntries(this.var)).map(([k, value]) => [
          k,
          value.getData(),
        ]),
      ),
      scope: this.scope,
    };
  }
}
