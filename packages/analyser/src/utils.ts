import type { NodePath, Node } from "@babel/traverse";
import path from "path";

export function isHook(filePath: string) {
  return path.basename(filePath).startsWith("use");
}

export function returnJSX(nodePath: Node): boolean {
  if (
    nodePath.type != "FunctionDeclaration" &&
    nodePath.type != "ArrowFunctionExpression" &&
    nodePath.type != "FunctionExpression"
  ) {
    return false;
  }

  if (nodePath.body.type === "JSXElement") {
    return true;
  }

  if (nodePath.body.type !== "BlockStatement") {
    return false;
  }

  for (const body of nodePath.body.body) {
    if (body.type === "ReturnStatement") {
      if (
        body.argument?.type === "JSXElement" ||
        body.argument?.type === "JSXFragment"
      ) {
        return true;
      }
    }
  }

  return false;
}

export function containsJSX(nodePath: NodePath): boolean {
  let found = false;

  const initPath =
    nodePath.get && nodePath.get("init") ? nodePath.get("init") : null;

  const startPaths: NodePath[] = [];
  if (initPath && initPath.node) {
    startPaths.push(initPath as NodePath);
  } else {
    startPaths.push(nodePath);
  }

  const expandCallArgs = (p: NodePath) => {
    if (p.isCallExpression()) {
      for (const argPath of p.get("arguments")) {
        if (
          argPath.isFunction() ||
          argPath.isArrowFunctionExpression() ||
          argPath.isFunctionExpression()
        ) {
          startPaths.push(argPath as NodePath);
        } else {
          startPaths.push(argPath as NodePath);
        }
      }
    }
  };

  for (const sp of [...startPaths]) expandCallArgs(sp);

  for (const sp of startPaths) {
    try {
      sp.traverse({
        JSXElement(path) {
          found = true;
          path.stop();
        },
        JSXFragment(path) {
          found = true;
          path.stop();
        },
      });
    } catch (_e) {
      /* empty */
    }
    if (found) break;
  }

  return found;
}
