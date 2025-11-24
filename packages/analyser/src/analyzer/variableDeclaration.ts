import * as t from "@babel/types";
import traverse from "@babel/traverse";
import type { ComponentDB } from "../db/componentDB.js";
import type { ComponentFileVarDependency, State } from "shared";
import { containsJSX } from "../utils.js";
import assert from "assert";
import { getVariableComponentName } from "../variable.js";

export default function VariableDeclarator(
  componentDB: ComponentDB,
  fileName: string
): traverse.VisitNode<traverse.Node, t.VariableDeclarator> {
  return (nodePath) => {
    const id = nodePath.node.id;
    const init = nodePath.node.init;

    if (t.isCallExpression(init)) {
      const firstArg = init.arguments[0];
      const firstArgPath = nodePath.get("init").get("arguments")[0];

      // console.log(firstArg, fileName);
      if (
        (t.isArrowFunctionExpression(firstArgPath?.node) ||
          t.isFunctionExpression(firstArgPath?.node)) &&
        containsJSX(firstArgPath)
      ) {
        componentDB.addComponent({
          name: id?.name,
          file: fileName,
          type: "Function",
          states: [],
          hooks: [],
          props: [],
          contexts: [],
          renders: [],
        });
      } else if (
        t.isIdentifier(init.callee) &&
        init.callee.name === "useState"
      ) {
        const id = nodePath.node.id;

        if (t.isArrayPattern(id)) {
          const [stateVar, setterVar] = id.elements;

          let state: State | null = null;
          if (t.isIdentifier(stateVar)) {
            state = { value: stateVar.name };
          }
          if (t.isIdentifier(setterVar)) {
            assert(state != null, "useState have setter without value");
            state!.setter = setterVar.name;
          }

          if (state != null) {
            const name = getVariableComponentName(nodePath);

            if (name) {
              componentDB.comAddState(name, fileName, state);
            }
          }
        }
      }
    }

    if (id.type !== "Identifier") return;

    const name = id.name;

    if (
      !init ||
      (init.type !== "ArrowFunctionExpression" &&
        init.type !== "FunctionExpression")
    )
      return;

    if (containsJSX(nodePath)) {
      componentDB.addComponent({
        name,
        file: fileName,
        type: "Function",
        states: [],
        hooks: [],
        props: [],
        contexts: [],
        renders: [],
      });
    }
  };
}
