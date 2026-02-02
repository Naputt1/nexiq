import type {
  ComponentFileVarBaseTypeFunction,
  ComponentFileVarFunction,
} from "shared";
import type { File } from "../fileDB.js";
import { BaseFunctionVariable } from "./baseFunctionVariable.js";

export class FunctionVariable extends BaseFunctionVariable<"normal"> {
  constructor(
    options: Omit<
      ComponentFileVarBaseTypeFunction<"normal">,
      "var" | "components" | "type" | "kind" | "file"
    >,
    file: File,
  ) {
    super({ ...options, kind: "normal" }, file);
  }

  public load(data: FunctionVariable) {
    super.load(data);
  }

  protected getBaseData(): ComponentFileVarBaseTypeFunction<"normal"> {
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

  public getData(): ComponentFileVarFunction {
    return {
      ...super.getBaseData(),
      kind: "normal",
    };
  }
}
