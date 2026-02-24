import type { NodePath, Node } from "@babel/traverse";
import * as t from "@babel/types";
import path from "path";
import type { ComponentDB } from "./db/componentDB.js";

export function isHook(name: string) {
  return name.startsWith("use");
}

export function getReactHookInfo(
  call: t.CallExpression,
  componentDB: ComponentDB,
  fileName: string,
): { name: string; isReact: boolean } | null {
  const callee = call.callee;
  const file = componentDB.getFile(fileName);
  if (!file) return null;

  if (t.isIdentifier(callee)) {
    const localName = callee.name;
    const comImport = file.import.get(localName);

    if (comImport?.source === "react") {
      if (comImport.type === "named") {
        return {
          name: comImport.importedName || localName,
          isReact: true,
        };
      }
      if (
        (comImport.type === "default" || comImport.type === "namespace") &&
        localName.startsWith("use")
      ) {
        return { name: localName, isReact: true };
      }
    }

    if (localName.startsWith("use")) {
      return { name: localName, isReact: false };
    }
  } else if (t.isMemberExpression(callee)) {
    if (t.isIdentifier(callee.property)) {
      const propName = callee.property.name;

      if (t.isIdentifier(callee.object)) {
        const objName = callee.object.name;
        const comImport = file.import.get(objName);

        if (comImport?.source === "react") {
          if (comImport.type === "default" || comImport.type === "namespace") {
            return { name: propName, isReact: true };
          }
        }

        if (objName === "React") {
          return { name: propName, isReact: true };
        }
      }

      if (propName.startsWith("use")) {
        return { name: propName, isReact: false };
      }
    }
  }

  return null;
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

export function isRefUsed(
  nodePath: NodePath<
    t.FunctionDeclaration | t.ArrowFunctionExpression | t.FunctionExpression
  >,
): boolean {
  const params = nodePath.node.params;
  if (params.length === 0) return false;

  const firstParam = params[0];
  if (t.isObjectPattern(firstParam)) {
    for (const prop of firstParam.properties) {
      if (
        t.isObjectProperty(prop) &&
        t.isIdentifier(prop.key) &&
        prop.key.name === "ref"
      ) {
        if (t.isIdentifier(prop.value)) {
          const binding = nodePath.scope.getBinding(prop.value.name);
          if (binding && binding.referenced) return true;
        }
      }
    }
  } else if (t.isIdentifier(firstParam)) {
    const propsName = firstParam.name;
    let found = false;
    nodePath.traverse({
      MemberExpression(p) {
        if (
          t.isIdentifier(p.node.object) &&
          p.node.object.name === propsName &&
          t.isIdentifier(p.node.property) &&
          p.node.property.name === "ref"
        ) {
          found = true;
          p.stop();
        }
      },
    });
    return found;
  }
  return false;
}

export function isForwardRefRefUsed(
  nodePath: NodePath<
    t.FunctionDeclaration | t.ArrowFunctionExpression | t.FunctionExpression
  >,
): boolean {
  const params = nodePath.node.params;
  if (params.length < 2) return false;

  const secondParam = params[1];
  if (t.isIdentifier(secondParam)) {
    const binding = nodePath.scope.getBinding(secondParam.name);
    return !!(binding && binding.referenced);
  }
  return false;
}

export function isForwardRefCall(
  call: t.CallExpression,
  componentDB: ComponentDB,
  fileName: string,
): boolean {
  const callee = call.callee;
  if (t.isIdentifier(callee)) {
    const file = componentDB.getFile(fileName);
    if (file) {
      const comImport = file.import.get(callee.name);
      if (comImport?.source === "react") {
        if (
          comImport.type === "named" &&
          comImport.importedName === "forwardRef"
        ) {
          return true;
        }
        if (comImport.type === "default") {
          // This would be strange for forwardRef, but possible if someone does `import forwardRef from 'react'`
          return true;
        }
      }
      // Handle aliased forwardRef via import tracking
      for (const imp of file.import.values()) {
        if (
          imp.source === "react" &&
          imp.importedName === "forwardRef" &&
          imp.localName === callee.name
        ) {
          return true;
        }
      }
    }
  } else if (t.isMemberExpression(callee)) {
    if (
      t.isIdentifier(callee.object) &&
      callee.object.name === "React" &&
      t.isIdentifier(callee.property) &&
      callee.property.name === "forwardRef"
    ) {
      return true;
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
