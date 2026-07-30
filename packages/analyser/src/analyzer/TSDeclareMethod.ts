import type traverse from "@babel/traverse";
import type { ComponentDB } from "../db/componentDB.ts";

export default function TSDeclareMethod(
  _componentDB: ComponentDB,
  _fileName: string,
): traverse.VisitNode<traverse.Node, { type: "TSDeclareMethod" }> {
  return {};
}
