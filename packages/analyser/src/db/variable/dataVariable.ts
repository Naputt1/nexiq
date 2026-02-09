import type { ComponentFileVarNormal, ComponentInfoRender } from "shared";
import { Variable } from "./variable.js";
import type { File } from "../fileDB.js";

export class DataVariable extends Variable<"data"> {
  components: Map<string, ComponentInfoRender>;

  constructor(
    options: Omit<
      ComponentFileVarNormal,
      "kind" | "var" | "components" | "file" | "hash"
    >,
    file: File,
  ) {
    super({ ...options, kind: "normal", type: "data" }, file);
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
      kind: "normal",
      loc: this.loc,
      components: Object.fromEntries(this.components),
    };
  }

  protected getDataInternal() {
    return {
      name: this.name,
      components: Object.fromEntries(this.components),
    };
  }
}
