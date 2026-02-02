import type { VariableScope, ComponentFileVarBaseTypeFunction } from "shared";
import { Variable } from "./variable.js";
import type { File } from "../fileDB.js";

export abstract class BaseFunctionVariable extends Variable {
  var: Map<string, Variable>;
  scope: VariableScope;

  constructor(
    options: Omit<
      ComponentFileVarBaseTypeFunction,
      "var" | "components" | "type"
    >,
    file: File,
  ) {
    super({ ...options, type: "function" }, file);
    this.var = new Map();
    this.scope = options.scope;
  }

  public load(data: BaseFunctionVariable) {
    super.load(data);

    this.type = data.type;
    this.scope = data.scope;
  }

  protected getBaseData(): ComponentFileVarBaseTypeFunction {
    return {
      ...super.getBaseData(),
      var: Object.fromEntries(
        Object.entries(Object.fromEntries(this.var)).map(([k, value]) => [
          k,
          value.getData(),
        ]),
      ),
      type: "function",
      scope: this.scope,
    };
  }
}
