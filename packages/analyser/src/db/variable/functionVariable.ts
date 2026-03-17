import type {
  ComponentFileVarBaseTypeFunction,
  ComponentFileVarFunction,
} from "@nexu/shared";
import type { File } from "../fileDB.js";
import { BaseFunctionVariable } from "./baseFunctionVariable.js";

export class FunctionVariable extends BaseFunctionVariable<"normal"> {
  constructor(
    options: Omit<
      ComponentFileVarBaseTypeFunction<"normal">,
      "var" | "components" | "type" | "kind" | "file" | "hash"
    >,
    file: File,
  ) {
    super({ ...options, kind: "normal", type: "function" }, file);
  }

  public load(data: FunctionVariable) {
    super.load(data);
  }

  protected getBaseData(): ComponentFileVarBaseTypeFunction<"normal"> {
    return {
      ...super.getBaseData(),
      type: "function",
    };
  }

  public getData(): ComponentFileVarFunction {
    return {
      ...this.getBaseData(),
      kind: "normal",
    } as ComponentFileVarFunction;
  }
}
