import * as t from "@babel/types";
import traverse from "@babel/traverse";
import type { ComponentDB } from "../db/componentDB.js";
import { containsJSX, isHook } from "../utils.js";

export default function FunctionDeclaration(
  componentDB: ComponentDB,
  fileName: string
): traverse.VisitNode<traverse.Node, t.FunctionDeclaration> {
  return (nodePath) => {
    const name = nodePath.node.id?.name;
    if (!name) return;

    if (isHook(name)) {
      const isExported =
        nodePath.parentPath.isExportNamedDeclaration() ||
        nodePath.parentPath.isExportDefaultDeclaration();

      if (!isExported) return;

      componentDB.addHook({
        name,
        file: fileName,
        states: [],
        props: [],
      });
    }

    if (containsJSX(nodePath)) {
      componentDB.addComponent({
        name,
        file: fileName,
        type: "Function",
        states: [],
        hooks: [],
        props: [],
        contexts: [],
        renders: [],
        dependencies: [],
      });
    }
  };
}
