import * as t from "@babel/types";
import traverse from "@babel/traverse";
import type { TypeDataDeclareType } from "shared";
import assert from "assert";
import type { ComponentDB } from "../../db/componentDB.js";
import { getType } from "./helper.js";

export default function TSTypeAliasDeclaration(
  componentDB: ComponentDB,
  fileName: string
): traverse.VisitNode<traverse.Node, t.TSTypeAliasDeclaration> {
  return (nodePath) => {
    const name = nodePath.node.id.name;
    assert(nodePath.node.id.loc != null);

    if (name === "FormWrapperProp") debugger;

    const loc = {
      line: nodePath.node.id.loc.start.line,
      column: nodePath.node.id.loc.start.column,
    };

    componentDB.fileAddTsTypes(fileName, {
      type: "type",
      name,
      body: getType(nodePath.node.typeAnnotation),
      loc,
    } as TypeDataDeclareType);
  };
}
