import * as t from "@babel/types";
import type traverse from "@babel/traverse";
import type { ComponentDB } from "../db/componentDB.ts";
import { isHook, returnJSX, isRefUsed } from "../utils.ts";
import assert from "assert";
import { getProps } from "./propExtractor.ts";
import { getPattern } from "./pattern.ts";
import type {
  ComponentFileVarFunctionComponent,
  ComponentFileVarHook,
  ComponentFileVarNormalFunction,
} from "@nexiq/shared";
import { getDeterministicId } from "../utils/hash.ts";

export default function FunctionDeclaration(
  componentDB: ComponentDB,
  fileName: string,
): traverse.VisitNode<traverse.Node, t.FunctionDeclaration> {
  return (nodePath) => {
    if (!nodePath.node.id) return;
    const name = nodePath.node.id.name;
    const pattern = getPattern(nodePath.node.id);
    assert(nodePath.node.id.loc?.start != null);

    const loc = {
      line: nodePath.node.id.loc.start.line,
      column: nodePath.node.id.loc.start.column,
    };

    const componentId = getDeterministicId(fileName, name);

    assert(nodePath.node.loc != null, "Function loc not found");

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

    if (nodePath.parentPath.scope.block.type === "Program") {
      if (returnJSX(nodePath.node)) {
        const { props, propName } = getProps(nodePath, undefined, componentId);
        componentDB.addFunctionComponent(fileName, {
          name: pattern,
          type: "function",
          componentType: "Function",
          hooks: [],
          props,
          propName,
          contexts: [],
          dependencies: {},
          var: {},
          children: {},
          loc,
          scope,
          async: nodePath.node.async,
          effects: {},
          refs: [],
          forwardRef: isRefUsed(nodePath),
        } as Omit<
          ComponentFileVarFunctionComponent,
          "id" | "kind" | "states" | "hash" | "file"
        >);
        return;
      }

      if (isHook(name)) {
        const { props, propName } = getProps(nodePath, undefined, componentId);
        componentDB.addHook(fileName, {
          name: pattern,
          dependencies: {},
          type: "function",
          loc,
          scope,
          async: nodePath.node.async,
          props,
          propName,
          effects: {},
          hooks: [],
          refs: [],
          children: {},
          var: {},
        } as Omit<
          ComponentFileVarHook,
          "kind" | "id" | "var" | "components" | "states" | "hash" | "file"
        >);
        return;
      }

      componentDB.addVariable(fileName, {
        name: pattern,
        dependencies: {},
        type: "function",
        loc,
        scope,
        async: nodePath.node.async,
        children: {},
        var: {},
      } as Omit<
        ComponentFileVarNormalFunction,
        "kind" | "file" | "id" | "var" | "components" | "hash"
      >);
    } else {
      componentDB.addVariable(fileName, {
        name: pattern,
        dependencies: {},
        type: "function",
        loc,
        scope,
        async: nodePath.node.async,
        children: {},
        var: {},
      } as Omit<
        ComponentFileVarNormalFunction,
        "kind" | "file" | "id" | "var" | "components" | "hash"
      >);
    }
  };
}
