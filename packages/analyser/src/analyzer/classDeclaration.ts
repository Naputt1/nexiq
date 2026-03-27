import * as t from "@babel/types";
import type traverse from "@babel/traverse";
import type { ComponentDB } from "../db/componentDB.js";
import { returnJSX } from "../utils.js";
import assert from "assert";
import { getPattern } from "./pattern.js";
import type {
  ComponentFileVar,
  ComponentFileVarComponent,
  DistributiveOmit,
} from "@nexiq/shared";
import { generateFn } from "../utils/babel.js";

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

    const superClassNode = nodePath.node.superClass;
    let superClass: { id?: string; name: string } | undefined;
    if (superClassNode) {
      if (t.isIdentifier(superClassNode)) {
        superClass = { name: superClassNode.name };
      } else {
        superClass = { name: generateFn(superClassNode).code };
      }
    }

    let isComponent = false;
    // Heuristic: check if it has a render method returning JSX
    for (const member of nodePath.node.body.body) {
      if (
        t.isClassMethod(member) &&
        t.isIdentifier(member.key, { name: "render" })
      ) {
        if (returnJSX(member)) {
          isComponent = true;
          break;
        }
      }
      if (
        t.isClassProperty(member) &&
        t.isIdentifier(member.key, { name: "render" })
      ) {
        if (
          t.isArrowFunctionExpression(member.value) ||
          t.isFunctionExpression(member.value)
        ) {
          if (returnJSX(member.value)) {
            isComponent = true;
            break;
          }
        }
      }
    }

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
        superClass,
      } as unknown as Omit<
        ComponentFileVarComponent,
        "id" | "kind" | "states" | "hash" | "file"
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
          superClass,
        } as DistributiveOmit<
          ComponentFileVar,
          "id" | "kind" | "var" | "children" | "file" | "hash" | "components"
        >,
        "class",
        "const",
      );
    }
  };
}
