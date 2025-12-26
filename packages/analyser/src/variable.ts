import type { NodePath } from "@babel/traverse";
import * as t from "@babel/types";
import { assert } from "console";
import type { VariableLoc } from "shared";

interface VariableComponentName {
  name: string;
  loc: VariableLoc;
}

export function getVariableComponentName(
  path: NodePath<t.VariableDeclarator>
): VariableComponentName | null {
  const compPath = path.findParent(
    (p) =>
      p.isFunctionDeclaration() ||
      (p.isVariableDeclarator() &&
        t.isIdentifier(p.node.id) &&
        (t.isArrowFunctionExpression(p.node.init) ||
          t.isFunctionExpression(p.node.init)))
  );

  if (compPath) {
    if (compPath.isFunctionDeclaration() && compPath.node.id) {
      const start = compPath.node.id.loc?.start;

      if (start == null) {
        return null;
      }
      assert(start != null);

      return {
        name: compPath.node.id.name,
        loc: {
          line: start.line,
          column: start.column,
        },
      };
    } else if (
      compPath.isVariableDeclarator() &&
      t.isIdentifier(compPath.node.id)
    ) {
      const start = compPath.node.id.loc?.start;

      if (start == null) {
        return null;
      }
      assert(start != null);

      return {
        name: compPath.node.id.name,
        loc: {
          line: start.line,
          column: start.column,
        },
      };
    }
  }

  // const id = path.node.id;
  // if (t.isIdentifier(id)) {
  //   return id.name;
  // }
  // if (t.isArrayPattern(id)) {
  //   if (t.isIdentifier(id.elements[0])) {
  //     return id.elements[0].name;
  //   }
  // }

  return null;
}

export function isCommented(path: NodePath<t.VariableDeclarator>): boolean {
  const comments =
    path.node.leadingComments || path.parentPath.node.leadingComments;
  return (
    (comments && comments.some((c) => c.value.includes("useState"))) ?? false
  );
}
