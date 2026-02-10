import type {
  ComponentFileVarNormal,
  ComponentFileVarNormalData,
  ComponentInfoRender,
} from "shared";
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
    if (data.components) {
      this.components = new Map(Object.entries(data.components));
    }
  }

  public getData(): ComponentFileVarNormal {
    return {
      ...this.getBaseData(),
      type: "data",
      kind: "normal",
      components: Object.fromEntries(this.components),
    };
  }

  protected getBaseData(): ComponentFileVarNormalData {
    return {
      ...super.getBaseData(),
      components: Object.fromEntries(this.components),
    } as ComponentFileVarNormalData;
  }

  protected getDataInternal() {
    return {
      name: this.name,
      components: Object.fromEntries(this.components),
    };
  }
}
