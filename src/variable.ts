import type { NodePath } from "@babel/traverse";
import * as t from "@babel/types";

export function getVariableComponentName(
  path: NodePath<t.VariableDeclarator>
): string | null {
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
      return compPath.node.id.name;
    } else if (
      compPath.isVariableDeclarator() &&
      t.isIdentifier(compPath.node.id)
    ) {
      return compPath.node.id.name;
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
