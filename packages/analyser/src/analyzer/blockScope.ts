import * as t from "@babel/types";
import type traverse from "@babel/traverse";
import type { ComponentDB } from "../db/componentDB.ts";

function toScope(node: t.Node) {
  if (!node.loc) return null;
  return {
    start: {
      line: node.loc.start.line,
      column: node.loc.start.column,
    },
    end: {
      line: node.loc.end.line,
      column: node.loc.end.column,
    },
  };
}

export default function BlockScope(componentDB: ComponentDB, fileName: string) {
  const addScope = (node: t.Node | null | undefined) => {
    if (!node) return;
    const scope = toScope(node);
    if (!scope) return;
    componentDB.addBlockScope(fileName, scope);
  };

  return {
    BlockStatement: {
      enter(nodePath: traverse.NodePath<t.BlockStatement>) {
        const parent = nodePath.parentPath;
        if (
          parent.isFunctionDeclaration() ||
          parent.isFunctionExpression() ||
          parent.isArrowFunctionExpression() ||
          parent.isClassMethod() ||
          parent.isClassPrivateMethod() ||
          parent.isObjectMethod() ||
          parent.isProgram()
        ) {
          return;
        }

        addScope(nodePath.node);
      },
    },
    SwitchStatement: {
      enter(nodePath: traverse.NodePath<t.SwitchStatement>) {
        addScope(nodePath.node);
      },
    },
    ForStatement: {
      enter(nodePath: traverse.NodePath<t.ForStatement>) {
        addScope(nodePath.node);
      },
    },
    ForInStatement: {
      enter(nodePath: traverse.NodePath<t.ForInStatement>) {
        addScope(nodePath.node);
      },
    },
    ForOfStatement: {
      enter(nodePath: traverse.NodePath<t.ForOfStatement>) {
        addScope(nodePath.node);
      },
    },
    CatchClause: {
      enter(nodePath: traverse.NodePath<t.CatchClause>) {
        addScope(nodePath.node);
      },
    },
  };
}
