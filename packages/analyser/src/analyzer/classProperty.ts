import * as t from "@babel/types";
import type traverse from "@babel/traverse";
import type { ComponentDB } from "../db/componentDB.js";
import { getPattern } from "./pattern.js";
import type { ComponentFileVar, DistributiveOmit } from "@nexiq/shared";

export default function ClassProperty(
  componentDB: ComponentDB,
  fileName: string,
): traverse.VisitNode<traverse.Node, t.ClassProperty | t.ClassPrivateProperty> {
  return (nodePath) => {
    const node = nodePath.node;
    const isPrivate = t.isClassPrivateProperty(node);

    const loc = {
      line: node.key.loc!.start.line,
      column: node.key.loc!.start.column,
    };

    const pattern = isPrivate
      ? getPattern((node as t.ClassPrivateProperty).key.id as t.LVal)
      : getPattern((node as t.ClassProperty).key as t.LVal);

    componentDB.addVariable(
      fileName,
      {
        name: pattern,
        dependencies: {},
        type: "data",
        loc,
        isStatic: !isPrivate && (node as t.ClassProperty).static,
        memberKind: isPrivate ? "private-property" : "property",
      } as DistributiveOmit<
        ComponentFileVar,
        "id" | "kind" | "var" | "children" | "file" | "hash" | "components"
      >,
      "property",
    );
  };
}
