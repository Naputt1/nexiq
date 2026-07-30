import * as t from "@babel/types";
import type traverse from "@babel/traverse";
import type { ComponentDB } from "../db/componentDB.ts";
import { getPattern } from "./pattern.ts";
import type { ComponentFileVar, DistributiveOmit } from "@nexiq/shared";

export default function TSEnumDeclaration(
  componentDB: ComponentDB,
  fileName: string,
): traverse.VisitNode<traverse.Node, t.TSEnumDeclaration> {
  return {
    enter(nodePath) {
      const node = nodePath.node;
      const name = node.id.name;

      const loc = {
        line: node.id.loc!.start.line,
        column: node.id.loc!.start.column,
      };

      const pattern = getPattern(node.id);

      const enumId = componentDB.addVariable(
        fileName,
        {
          name: pattern,
          dependencies: {},
          type: "data",
          loc,
        } as DistributiveOmit<
          ComponentFileVar,
          "id" | "kind" | "var" | "children" | "file" | "hash" | "components"
        >,
        "normal",
      );

      for (const member of node.members) {
        if (t.isIdentifier(member.id)) {
          const memberLoc = {
            line: member.id.loc!.start.line,
            column: member.id.loc!.start.column,
          };
          componentDB.addVariable(
            fileName,
            {
              name: getPattern(member.id),
              dependencies: {},
              type: "data",
              loc: memberLoc,
              parentId: enumId,
            } as DistributiveOmit<
              ComponentFileVar,
              "id" | "kind" | "var" | "children" | "file" | "hash" | "components"
            >,
            "normal",
          );
        }
      }
    },
  };
}
