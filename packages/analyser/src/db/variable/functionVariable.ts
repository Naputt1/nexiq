import type {
  ComponentFileVarBaseTypeFunction,
  ComponentFileVarFunction,
} from "@nexiq/shared";
import type { File } from "../fileDB.ts";
import { BaseFunctionVariable } from "./baseFunctionVariable.ts";

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

  public load(data: Partial<ComponentFileVarFunction>) {
    super.load(data);
  }

  protected getBaseData(): ComponentFileVarBaseTypeFunction<"normal"> {
    return {
      ...super.getBaseData(),
      type: "function",
    };
  }

  public getData(): ComponentFileVarFunction {
    return this.getBaseData() as ComponentFileVarFunction;
  }

  protected getDataInternal() {
    return super.getDataInternal();
  }
}
