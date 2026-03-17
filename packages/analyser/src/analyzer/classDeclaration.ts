import * as t from "@babel/types";
import type traverse from "@babel/traverse";
import type { ComponentDB } from "../db/componentDB.js";
import { returnJSX } from "../utils.js";
import assert from "assert";
import { getPattern } from "./pattern.js";
import type { ComponentFileVarComponent } from "@nexu/shared";

export default function ClassDeclaration(
  componentDB: ComponentDB,
  fileName: string,
): traverse.VisitNode<traverse.Node, t.ClassDeclaration | t.ClassExpression> {
  return (nodePath) => {
    const id = nodePath.node.id;
    if (!id && nodePath.isClassDeclaration()) return;

    const pattern = id
      ? getPattern(id)
      : ({
          type: "identifier" as const,
          name: "anonymous",
          loc: { line: 0, column: 0 },
          id: "anonymous",
        } as const);

    const loc = id?.loc
      ? {
          line: id.loc.start.line,
          column: id.loc.start.column,
        }
      : {
          line: nodePath.node.loc!.start.line,
          column: nodePath.node.loc!.start.column,
        };

    assert(nodePath.node.loc != null, "Class loc not found");

    const scope = {
      start: {
        line: nodePath.node.loc.start.line,
        column: nodePath.node.loc.start.column,
      },
      end: {
        line: nodePath.node.loc.end.line,
        column: nodePath.node.loc.end.column,
      },
    };

    let isComponent = false;
    // Heuristic: check if it has a render method returning JSX
    nodePath.traverse({
      ClassMethod(methodPath) {
        if (t.isIdentifier(methodPath.node.key, { name: "render" })) {
          if (returnJSX(methodPath.node)) {
            isComponent = true;
            methodPath.stop();
          }
        }
      },
      ClassProperty(propPath) {
        if (t.isIdentifier(propPath.node.key, { name: "render" })) {
          if (
            t.isArrowFunctionExpression(propPath.node.value) ||
            t.isFunctionExpression(propPath.node.value)
          ) {
            if (returnJSX(propPath.node.value)) {
              isComponent = true;
              propPath.stop();
            }
          }
        }
      },
      FunctionDeclaration(fPath) {
        fPath.skip();
      },
      FunctionExpression(fPath) {
        fPath.skip();
      },
      ArrowFunctionExpression(fPath) {
        fPath.skip();
      },
    });

    if (isComponent) {
      componentDB.addComponent(fileName, {
        name: pattern,
        type: "class",
        componentType: "Class",
        hooks: [],
        states: [],
        props: [], // Class props extraction is complex, skipping for now
        propName: "this.props",
        contexts: [],
        dependencies: {},
        var: {},
        children: {},
        loc,
        scope,
        async: false,
        effects: {},
        forwardRef: false,
      } as unknown as Omit<
        ComponentFileVarComponent,
        "id" | "kind" | "hash" | "file"
      >);
    } else {
      // Just register as a variable
      componentDB.addVariable(
        fileName,
        {
          name: pattern,
          dependencies: {},
          type: "class",
          loc,
          scope,
          async: false,
          children: {},
          var: {},
        } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        "normal",
        "const",
      );
    }
  };
}
