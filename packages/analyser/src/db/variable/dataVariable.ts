import type {
  ComponentFileVarNormal,
  ComponentFileVarNormalData,
  ComponentInfoRender,
  VarKind,
} from "shared";
import { Variable } from "./variable.js";
import type { File } from "../fileDB.js";

export class DataVariable extends Variable<"data"> {
  renders: Record<string, ComponentInfoRender>;

  constructor(
    options: Omit<
      ComponentFileVarNormal,
      "kind" | "var" | "renders" | "file" | "hash"
    > & { kind?: VarKind },
    file: File,
  ) {
    super({ ...options, kind: options.kind ?? "normal", type: "data" }, file);
    this.renders = {};
  }

  public load(data: DataVariable) {
    super.load(data);

    this.type = data.type;
    // TODO: handle merge
    if (data.renders) {
      this.renders = { ...data.renders };
    }
  }

  public getData(): ComponentFileVarNormal {
    return {
      ...this.getBaseData(),
      type: "data",
      kind: this.kind as "normal",
      renders: this.renders,
    };
  }

  protected getBaseData(): ComponentFileVarNormalData {
    return {
      ...super.getBaseData(),
      renders: this.renders,
    } as ComponentFileVarNormalData;
  }

  protected getDataInternal() {
    return {
      name: this.name,
      renders: this.renders,
    };
  }
}
