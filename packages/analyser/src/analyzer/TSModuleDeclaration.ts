import * as t from "@babel/types";
import type traverse from "@babel/traverse";
import type { ComponentDB } from "../db/componentDB.ts";
import { getPattern } from "./pattern.ts";
import type { ComponentFileVar, DistributiveOmit } from "@nexiq/shared";

export default function TSModuleDeclaration(
  componentDB: ComponentDB,
  fileName: string,
): traverse.VisitNode<traverse.Node, t.TSModuleDeclaration> {
  return {
    enter(nodePath) {
      const node = nodePath.node;
      if (!t.isIdentifier(node.id)) return;

      const loc = {
        line: node.id.loc!.start.line,
        column: node.id.loc!.start.column,
      };

      componentDB.addVariable(
        fileName,
        {
          name: getPattern(node.id),
          dependencies: {},
          type: "data",
          loc,
        } as DistributiveOmit<
          ComponentFileVar,
          "id" | "kind" | "var" | "children" | "file" | "hash" | "components"
        >,
        "normal",
      );
    },
  };
}
