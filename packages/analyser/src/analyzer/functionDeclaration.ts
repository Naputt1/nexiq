import * as t from "@babel/types";
import type traverse from "@babel/traverse";
import type { ComponentDB } from "../db/componentDB.js";
import { isHook, returnJSX, isRefUsed } from "../utils.js";
import assert from "assert";
import { getProps } from "./propExtractor.js";
import { getPattern } from "./pattern.js";
import type {
  ComponentFileVarComponent,
  ComponentFileVarHook,
  ComponentFileVarNormalFunction,
} from "shared";
import { getDeterministicId } from "../utils/hash.js";

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
        componentDB.addComponent(fileName, {
          name: pattern,
          type: "function",
          componentType: "Function",
          hooks: [],
          props: getProps(nodePath, undefined, componentId),
          contexts: [],
          dependencies: {},
          var: {},
          children: {},
          loc,
          scope,
          effects: {},
          forwardRef: isRefUsed(nodePath),
        } as Omit<
          ComponentFileVarComponent,
          "id" | "kind" | "states" | "hash" | "file"
        >);
        return;
      }

      if (isHook(name)) {
        componentDB.addHook(fileName, {
          name: pattern,
          dependencies: {},
          type: "function",
          loc,
          scope,
          props: getProps(nodePath, undefined, componentId),
          effects: {},
          hooks: [],
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
        children: {},
        var: {},
      } as Omit<
        ComponentFileVarNormalFunction,
        "kind" | "file" | "id" | "var" | "components" | "hash"
      >);
    } else {
      if (
        nodePath.scope.block.type === "FunctionDeclaration" &&
        nodePath.scope.block.id?.type === "Identifier"
      ) {
        componentDB.addVariable(fileName, {
          name: pattern,
          dependencies: {},
          type: "function",
          loc,
          scope,
          children: {},
          var: {},
        } as Omit<
          ComponentFileVarNormalFunction,
          "kind" | "file" | "id" | "var" | "components" | "hash"
        >);
      }
    }
  };
}
