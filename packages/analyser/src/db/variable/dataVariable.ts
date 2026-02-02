import type { ComponentFileVarNormal, ComponentInfoRender } from "shared";
import { Variable } from "./variable.js";
import type { File } from "../fileDB.js";

export class DataVariable extends Variable {
  type: "function" | "data";
  components: Map<string, ComponentInfoRender>;

  constructor(
    options: Omit<
      ComponentFileVarNormal,
      "variableType" | "var" | "components"
    >,
    file: File,
  ) {
    super({ ...options, variableType: "normal" }, file);
    this.type = options.type;
    this.components = new Map();
  }

  public load(data: DataVariable) {
    super.load(data);

    this.type = data.type;
    // TODO: handle merge
    this.components = new Map(Object.entries(data.components));
  }

  public getData(): ComponentFileVarNormal {
    return {
      ...super.getBaseData(),
      type: "data",
      variableType: "normal",
      loc: this.loc,
      components: Object.fromEntries(this.components),
    };
  }
}
