import type { NodePath, Node } from "@babel/traverse";
import path from "path";

export function isHook(filePath: string) {
  return path.basename(filePath).startsWith("use");
}

export function returnJSX(node: Node): boolean {
  if (
    node.type != "FunctionDeclaration" &&
    node.type != "ArrowFunctionExpression" &&
    node.type != "FunctionExpression"
  ) {
    return false;
  }

  if (node.body.type === "JSXElement" || node.body.type === "JSXFragment") {
    return true;
  }

  if (node.body.type !== "BlockStatement") {
    return false;
  }

  let hasJSX = false;
  // Use a simple local visitor or recursive check
  const check = (n: Node) => {
    if (hasJSX) return;
    if (n.type === "ReturnStatement") {
      if (
        n.argument?.type === "JSXElement" ||
        n.argument?.type === "JSXFragment"
      ) {
        hasJSX = true;
      }
    }

    // Recurse into blocks, if statements, etc.
    if ("body" in n && n.body && typeof n.body === "object") {
      if (Array.isArray(n.body)) {
        n.body.forEach(check);
      } else {
        check(n.body as Node);
      }
    }
    if ("consequent" in n && n.consequent) check(n.consequent as Node);
    if ("alternate" in n && n.alternate) check(n.alternate as Node);
  };

  node.body.body.forEach(check);

  return hasJSX;
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
