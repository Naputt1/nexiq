import * as t from "@babel/types";
import traverse from "@babel/traverse";
import type { ComponentDB } from "../db/componentDB.js";
import { isHook, returnJSX } from "../utils.js";
import assert from "assert";

function getParentPath(nodePath: traverse.NodePath<t.Node>) {
  const parentPath: string[] = [];
  let path: traverse.NodePath<t.Node> = nodePath;
  while (true) {
    if (path.scope.block.type === "Program") {
      break;
    }

    if (path.scope.block.type === "FunctionDeclaration") {
      if (path.scope.block.id?.type === "Identifier") {
        parentPath.push(path.scope.block.id.name);
      }
    } else if (path.scope.block.type === "ArrowFunctionExpression") {
      if (path.scope.parentBlock.type == "VariableDeclarator") {
        if (path.scope.parentBlock.id.type === "Identifier") {
          parentPath.push(path.scope.parentBlock.id.name);
        }
      }
    }

    path = path.scope.parent.path;
  }

  return parentPath;
}
export default function FunctionDeclaration(
  componentDB: ComponentDB,
  fileName: string
): traverse.VisitNode<traverse.Node, t.FunctionDeclaration> {
  return (nodePath) => {
    const name = nodePath.node.id?.name;
    if (!name) return;
    assert(nodePath.node.id?.loc?.start != null);

    const loc = {
      line: nodePath.node.id.loc.start.line,
      column: nodePath.node.id.loc.start.column,
    };

    const scope = {
      start: {
        line: nodePath.node.id.loc.start.line,
        column: nodePath.node.id.loc.start.column,
      },
      end: {
        line: nodePath.node.id.loc.end.line,
        column: nodePath.node.id.loc.end.column,
      },
    };

    if (nodePath.parentPath.scope.block.type === "Program") {
      if (returnJSX(nodePath.node)) {
        componentDB.addComponent({
          name,
          file: fileName,
          type: "function",
          componentType: "Function",
          states: [],
          hooks: [],
          props: [],
          contexts: [],
          renders: {},
          dependencies: {},
          var: {},
          loc,
          scope,
          effects: {},
        });
        return;
      }

      if (isHook(name)) {
        componentDB.addHook({
          file: fileName,
          name,
          dependencies: {},
          type: "function",
          loc,
          scope,
          states: [],
          props: [],
          effects: {},
          hooks: [],
        });
        return;
      }

      componentDB.addVariable(fileName, {
        name,
        dependencies: {},
        type: "function",
        loc,
        scope,
      });
    } else {
      // if (
      //   nodePath.parent.type === "ExportDefaultDeclaration"
      //   // || nodePath.parent.type === "ExportNamedDeclaration"
      // ) {
      //   return;
      // }

      if (
        nodePath.scope.block.type === "FunctionDeclaration" &&
        nodePath.scope.block.id?.type === "Identifier"
      ) {
        const parentPath = getParentPath(nodePath.scope.parent.path);

        componentDB.addVariable(
          fileName,
          {
            name,
            dependencies: {},
            type: "function",
            loc,
            scope,
          },
          parentPath
        );
      }
    }
  };
}
