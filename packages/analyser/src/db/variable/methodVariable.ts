import type {
  ComponentFileVarBaseTypeFunction,
  ComponentFileVarMethod,
} from "@nexiq/shared";
import type { File } from "../fileDB.js";
import { BaseFunctionVariable } from "./baseFunctionVariable.js";

export class MethodVariable extends BaseFunctionVariable<"method", "function"> {
  constructor(
    options: Omit<
      ComponentFileVarMethod,
      "var" | "components" | "type" | "kind" | "file" | "hash"
    >,
    file: File,
  ) {
    super(
      { ...options, kind: "method", type: "function" } as Omit<
        ComponentFileVarBaseTypeFunction<"method", "function">,
        "var" | "components" | "file" | "hash"
      >,
      file,
    );
  }

  public load(data: MethodVariable) {
    super.load(data);
  }

  protected getBaseData(): ComponentFileVarMethod {
    return {
      ...super.getBaseData(),
      kind: "method",
      type: "function",
    };
  }

  public getData(): ComponentFileVarMethod {
    return this.getBaseData();
  }
}
