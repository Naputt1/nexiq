import type {
  VariableScope,
  ComponentFileVarBaseTypeFunction,
  VarKind,
  FunctionReturn,
  ComponentInfoRender,
  VarType,
} from "@nexiq/shared";
import { Variable } from "./variable.js";
import type { File } from "../fileDB.js";
import { Scope } from "./scope.js";
import { isJSXVariable } from "./type.js";

export abstract class BaseFunctionVariable<
  TKind extends VarKind,
  TType extends VarType = VarType,
> extends Variable<TType, TKind> {
  var: Scope;
  scope: VariableScope;
  async?: boolean | undefined;
  return?: FunctionReturn | undefined;
  children: Record<string, ComponentInfoRender>;

  constructor(
    options: Omit<
      ComponentFileVarBaseTypeFunction<TKind, TType>,
      "var" | "components" | "file" | "hash"
    >,
    file: File,
  ) {
    super(options, file);
    this.var = new Scope();
    this.scope = options.scope;
    this.async = options.async;
    this.return = options.return;
    this.children = options.children || {};
  }

  public load(data: Variable<TType, TKind>) {
    super.load(data);

    if (data instanceof BaseFunctionVariable) {
      this.type = data.type;
      this.scope = data.scope;
      this.async = data.async;
      this.return = data.return;
      this.children = data.children;
    }
  }

  protected getBaseData(): ComponentFileVarBaseTypeFunction<TKind, TType> {
    let returnData = this.return;
    if (typeof returnData === "string") {
      const v = this.file.var.get(returnData, true);
      if (v && isJSXVariable(v)) {
        returnData = v.getData();
      }
    }

    return {
      ...super.getBaseData(),
      type: this.type,
      var: this.var.getData(),
      scope: this.scope,
      async: this.async,
      return: returnData,
      children: this.children,
    };
  }

  protected getDataInternal() {
    return {
      name: this.name,
      var: this.var.getData(),
      scope: this.scope,
      async: this.async,
      return: this.return,
      children: this.children,
    };
  }
}
