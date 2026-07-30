import * as t from "@babel/types";
import type traverse from "@babel/traverse";
import type { ComponentDB } from "../db/componentDB.ts";
import assert from "assert";
import { getPattern, getVariableNameKey } from "./pattern.ts";
import { getDeterministicId } from "../utils/hash.ts";
import type { ComponentFileVar, DistributiveOmit } from "@nexiq/shared";
import { getStartLoc, LIFECYCLE_METHODS } from "./classDeclaration.ts";
import { isReactFunctionVariable } from "../db/variable/type.ts";

export default function ClassMethod(
  componentDB: ComponentDB,
  fileName: string,
): traverse.VisitNode<traverse.Node, t.ClassMethod | t.ClassPrivateMethod> {
  return {
    enter(nodePath) {
      const node = nodePath.node;
      const isPrivate = t.isClassPrivateMethod(node);

      const loc = {
        line: node.key.loc!.start.line,
        column: node.key.loc!.start.column,
      };

      assert(node.body.loc != null, "Method body loc not found");

      const scope = {
        start: {
          line: node.body.loc.start.line,
          column: node.body.loc.start.column,
        },
        end: {
          line: node.body.loc.end.line,
          column: node.body.loc.end.column,
        },
      };

      const pattern = isPrivate
        ? getPattern((node as t.ClassPrivateMethod).key.id as t.LVal)
        : getPattern((node as t.ClassMethod).key as t.LVal);

      const id = componentDB.addVariable(
        fileName,
        {
          name: pattern,
          dependencies: {},
          type: "function",
          loc,
          scope,
          async: node.async,
          isStatic: !isPrivate && (node as t.ClassMethod).static,
          memberKind: isPrivate
            ? "private-method"
            : (node as t.ClassMethod).kind,
        } as DistributiveOmit<
          ComponentFileVar,
          "id" | "kind" | "var" | "children" | "file" | "hash" | "components"
        >,
        "method",
      );

      // Lifecycle methods as effects
      if (
        !isPrivate &&
        t.isIdentifier(node.key) &&
        LIFECYCLE_METHODS.includes(node.key.name)
      ) {
        const file = componentDB.getFile(fileName);
        const component = file.var.findDeepestVariable(loc);
        if (component && isReactFunctionVariable(component)) {
          const methodLoc = getStartLoc(node.key);
          componentDB.comAddEffect(fileName, methodLoc, {
            name: node.key.name,
            loc: methodLoc,
            reactDeps: [],
            scope: {
              start: getStartLoc(node.body),
              end: {
                line: node.body.loc!.end.line,
                column: node.body.loc!.end.column,
              },
            },
          });
        }
      }

      // Register TSParameterProperty (constructor shorthand: constructor(public name: string))
      if (
        !isPrivate &&
        t.isIdentifier(node.key) &&
        (node as t.ClassMethod).kind === "constructor"
      ) {
        for (const param of (node as t.ClassMethod).params) {
          if (t.isTSParameterProperty(param) && t.isIdentifier(param.parameter)) {
            const pattern = getPattern(param.parameter);
            const pLoc = {
              line: param.parameter.loc!.start.line,
              column: param.parameter.loc!.start.column,
            };
            componentDB.addVariable(
              fileName,
              {
                name: pattern,
                dependencies: {},
                type: "data",
                loc: pLoc,
                memberKind: param.accessibility
                  ? `${param.accessibility}-property`
                  : "property",
              } as DistributiveOmit<
                ComponentFileVar,
                "id" | "kind" | "var" | "children" | "file" | "hash" | "components"
              >,
              "property",
            );
          }
        }
      }

      if (
        !isPrivate &&
        t.isIdentifier(node.key) &&
        node.key.name === "render"
      ) {
        componentDB.pushRenderInstance(id);
      }
    },
    exit(nodePath) {
      const node = nodePath.node;
      const isPrivate = t.isClassPrivateMethod(node);
      if (
        !isPrivate &&
        t.isIdentifier(node.key) &&
        node.key.name === "render"
      ) {
        componentDB.popRenderInstance();
      }
    },
  };
}
