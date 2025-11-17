import type { NodePath } from "@babel/traverse";
import path from "path";

export function isHook(filePath: string) {
  return path.basename(filePath).startsWith("use");
}

export function containsJSX(nodePath: NodePath): boolean {
  let found = false;

  const initPath =
    nodePath.get && nodePath.get("init") ? nodePath.get("init") : null;

  const startPaths: NodePath[] = [];
  if (initPath && initPath.node) {
    // @ts-ignore
    startPaths.push(initPath);
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
    } catch (e) {}
    if (found) break;
  }

  return found;
}

export function getImportFileName(name: string, fileName: string) {
  let source = name;
  let temp = source;
  if (source.startsWith(".") || source.startsWith("..")) {
    const fileDir = path.dirname(fileName);
    source = path.join(fileDir, source);
    source = path.normalize(source);
  } else if (!componentDB.isDependency(source)) {
    let isAliase = false;
    for (const alias in aliases) {
      if (source.startsWith(alias)) {
        source = path.join(
          aliases[alias] ?? "",
          `./${source.slice(alias.length)}`
        );
        isAliase = true;
        break;
      } else if (source.startsWith(alias + "/")) {
        source = path.join(
          aliases[alias] ?? "",
          `./${source.slice(alias.length + 1)}`
        );
        isAliase = true;
        break;
      }
    }

    if (isAliase) {
      source = path.join(SRC_DIR, source);
      source = path.resolve(source);
    }
  }

  if (source.startsWith("/")) {
    if (fs.existsSync(source) && fs.statSync(source).isDirectory()) {
      const indexExtension = ["tsx", "ts", "jsx", "js"];
      for (const ext of indexExtension) {
        const testFile = path.join(source, `index.${ext}`);
        if (fs.existsSync(testFile)) {
          source = testFile;
          break;
        }
      }
    } else {
      const indexExtension = ["tsx", "ts", "jsx", "js"];
      for (const ext of indexExtension) {
        const testFile = `${source}.${ext}`;
        if (fs.existsSync(testFile)) {
          source = testFile;
          break;
        }
      }
    }
  }
}
