import * as t from "@babel/types";
import type traverse from "@babel/traverse";
import assert from "assert";
import type { ComponentDB } from "../../db/componentDB.ts";
import { getType } from "./helper.ts";
import { getPattern } from "../pattern.ts";

export default function TSTypeAliasDeclaration(
  componentDB: ComponentDB,
  fileName: string,
): traverse.VisitNode<traverse.Node, t.TSTypeAliasDeclaration> {
  return (nodePath) => {
    const pattern = getPattern(nodePath.node.id);
    assert(nodePath.node.id.loc != null);

    const loc = {
      line: nodePath.node.id.loc.start.line,
      column: nodePath.node.id.loc.start.column,
    };

    componentDB.fileAddTsTypes(fileName, {
      type: "type",
      name: pattern,
      body: getType(nodePath.node.typeAnnotation),
      loc,
    });
  };
}
