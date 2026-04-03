import * as t from "@babel/types";
import type traverse from "@babel/traverse";
import { ComponentDB } from "../db/componentDB.ts";
import { extractStateKeys, getStartLoc } from "./classDeclaration.ts";
import {
  isClassComponentVariable,
  isMethodVariable,
} from "../db/variable/type.ts";
import { Variable } from "../db/variable/variable.ts";

export default function AssignmentExpression(
  componentDB: ComponentDB,
  fileName: string,
): traverse.VisitNode<traverse.Node, t.AssignmentExpression> {
  return {
    enter(nodePath) {
      const { left, right } = nodePath.node;

      // this.state = ...
      if (
        t.isMemberExpression(left) &&
        t.isThisExpression(left.object) &&
        t.isIdentifier(left.property, { name: "state" })
      ) {
        // Find the class component we are in
        const file = componentDB.getFile(fileName);
        const loc = getStartLoc(left);
        let component: Variable | undefined = file.var.findDeepestVariable(loc);
        if (component && isMethodVariable(component)) {
          component = component.parent;
        }

        if (component && isClassComponentVariable(component)) {
          const keys = extractStateKeys(right, nodePath.scope);
          for (const keyInfo of keys) {
            componentDB.addStateVariable(
              fileName,
              component.id,
              keyInfo.name,
              getStartLoc(left.property), // Use 'state' identifier loc
              keyInfo.type,
            );
          }
        }
      }

      // this.myRef = React.createRef()
      if (
        t.isMemberExpression(left) &&
        t.isThisExpression(left.object) &&
        t.isIdentifier(left.property) &&
        t.isCallExpression(right) &&
        t.isMemberExpression(right.callee) &&
        t.isIdentifier(right.callee.property, { name: "createRef" })
      ) {
        const file = componentDB.getFile(fileName);
        const loc = getStartLoc(left);
        const component = file.var.findDeepestVariable(loc);

        if (component && isClassComponentVariable(component)) {
          componentDB.addRefVariable(
            fileName,
            component.id,
            left.property.name,
            getStartLoc(left.property),
            { type: "undefined" },
          );
        }
      }
    },
  };
}
