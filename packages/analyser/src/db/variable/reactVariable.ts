import type { ComponentFileVarReact, ReactVarKind, VarType } from "shared";
import type { File } from "../fileDB.js";
import { Variable } from "./variable.js";

export abstract class ReactVariable<
  TType extends VarType = VarType,
  TKind extends ReactVarKind = ReactVarKind,
> extends Variable<TType, TKind> {
  constructor(
    options: Omit<ComponentFileVarReact<TType, TKind>, "file">,
    file: File,
  ) {
    super(options, file);
  }

  public load(data: ReactVariable<TType, TKind>) {
    super.load(data);
  }

  protected getBaseData(): ComponentFileVarReact<TType, TKind> {
    return {
      ...super.getBaseData(),
    };
  }
}
