import * as t from "@babel/types";
import type traverse from "@babel/traverse";
import type { ComponentDB } from "../db/componentDB.js";
import assert from "assert";
import { getPattern } from "./pattern.js";
import type { ComponentFileVar, DistributiveOmit } from "@nexiq/shared";

export default function ClassMethod(
  componentDB: ComponentDB,
  fileName: string,
): traverse.VisitNode<traverse.Node, t.ClassMethod | t.ClassPrivateMethod> {
  return (nodePath) => {
    const node = nodePath.node;
    const isPrivate = t.isClassPrivateMethod(node);

    const loc = {
      line: node.key.loc!.start.line,
      column: node.key.loc!.start.column,
    };

    assert(node.body.loc != null, "Method body loc not found");

    const scope = {
      start: {
        line: node.body.loc.start.line,
        column: node.body.loc.start.column,
      },
      end: {
        line: node.body.loc.end.line,
        column: node.body.loc.end.column,
      },
    };

    const pattern = isPrivate
      ? getPattern((node as t.ClassPrivateMethod).key.id as t.LVal)
      : getPattern((node as t.ClassMethod).key as t.LVal);

    componentDB.addVariable(
      fileName,
      {
        name: pattern,
        dependencies: {},
        type: "function",
        loc,
        scope,
        async: node.async,
        isStatic: !isPrivate && (node as t.ClassMethod).static,
        memberKind: isPrivate ? "private-method" : (node as t.ClassMethod).kind,
      } as DistributiveOmit<
        ComponentFileVar,
        "id" | "kind" | "var" | "children" | "file" | "hash" | "components"
      >,
      "method",
    );
  };
}
