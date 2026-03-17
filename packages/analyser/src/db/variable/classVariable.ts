import type {
  ComponentFileVarBaseTypeFunction,
  ComponentFileVarNormalFunction,
} from "@nexu/shared";
import type { File } from "../fileDB.js";
import { BaseFunctionVariable } from "./baseFunctionVariable.js";

export class ClassVariable extends BaseFunctionVariable<"normal"> {
  constructor(
    options: Omit<
      ComponentFileVarBaseTypeFunction<"normal">,
      "var" | "components" | "type" | "kind" | "file" | "hash"
    >,
    file: File,
  ) {
    super({ ...options, kind: "normal", type: "class" } as any, file); // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  public load(data: ClassVariable) {
    super.load(data);
  }

  protected getBaseData(): ComponentFileVarBaseTypeFunction<"normal", "class"> {
    return {
      ...super.getBaseData(),
      type: "class",
    };
  }

  public getData(): ComponentFileVarNormalFunction {
    return {
      ...this.getBaseData(),
      kind: "normal",
    } as unknown as ComponentFileVarNormalFunction;
  }
}
