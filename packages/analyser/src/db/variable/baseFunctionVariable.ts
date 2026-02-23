import type {
  VariableScope,
  ComponentFileVarBaseTypeFunction,
  VarKind,
  FunctionReturn,
  ComponentInfoRender,
} from "shared";
import { Variable } from "./variable.js";
import type { File } from "../fileDB.js";
import { Scope } from "./scope.js";
import { isJSXVariable } from "./type.js";

export abstract class BaseFunctionVariable<
  TKind extends VarKind,
> extends Variable<"function", TKind> {
  var: Scope;
  scope: VariableScope;
  return?: FunctionReturn | undefined;
  children: Record<string, ComponentInfoRender>;

  constructor(
    options: Omit<
      ComponentFileVarBaseTypeFunction<TKind>,
      "var" | "components" | "type" | "file" | "hash"
    >,
    file: File,
  ) {
    super({ ...options, type: "function" }, file);
    this.var = new Scope();
    this.scope = options.scope;
    this.return = options.return;
    this.children = options.children || {};
  }

  public load(data: BaseFunctionVariable<TKind>) {
    super.load(data);

    this.type = data.type;
    this.scope = data.scope;
    this.return = data.return;
    this.children = data.children;
  }

  protected getBaseData(): ComponentFileVarBaseTypeFunction<TKind> {
    let returnData = this.return;
    if (typeof returnData === "string") {
      const v = this.file.var.get(returnData, true);
      if (v && isJSXVariable(v)) {
        returnData = v.getData();
      }
    }

    return {
      ...super.getBaseData(),
      var: this.var.getData(),
      scope: this.scope,
      return: returnData,
      children: this.children,
    };
  }

  protected getDataInternal() {
    return {
      name: this.name,
      var: this.var.getData(),
      scope: this.scope,
      return: this.return,
      children: this.children,
    };
  }
}
