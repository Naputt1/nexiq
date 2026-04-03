import type {
  VariableScope,
  ComponentFileVarBaseTypeFunction,
  VarKind,
  FunctionReturn,
  ComponentInfoRender,
  VarType,
} from "@nexiq/shared";
import { Variable } from "./variable.ts";
import type { File } from "../fileDB.ts";
import { Scope } from "./scope.ts";

export abstract class BaseFunctionVariable<
  TKind extends VarKind,
  TType extends VarType = VarType,
> extends Variable<TType, TKind> {
  var: Scope;
  scope: VariableScope;
  async?: boolean | undefined;
  return?: FunctionReturn | undefined;
  children: Record<string, ComponentInfoRender>;
  superClass?: { id?: string; name: string } | undefined;

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
    this.children = {};
    this.superClass = options.superClass;
  }

  public load(data: BaseFunctionVariable<TKind, TType>) {
    super.load(data);

    if (data instanceof BaseFunctionVariable) {
      this.type = data.type;
      this.scope = data.scope || this.scope;
      this.async = data.async;
      this.return = data.return;
      this.children = { ...this.children, ...data.children };
      this.superClass = data.superClass;
      this.var.merge(data.var);
    }
  }

  protected getBaseData(): ComponentFileVarBaseTypeFunction<TKind, TType> {
    return {
      ...super.getBaseData(),
      type: this.type,
      var: this.var.getData(),
      scope: this.scope,
      async: this.async,
      return: this.return,
      superClass: this.superClass,
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
      superClass: this.superClass,
    };
  }
}
