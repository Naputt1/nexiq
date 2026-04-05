import * as t from "@babel/types";
import type traverse from "@babel/traverse";
import { ComponentDB } from "../db/componentDB.ts";
import { getStartLoc } from "./classDeclaration.ts";
import { isReactFunctionVariable } from "../db/variable/type.ts";

export default function MemberExpression(
  componentDB: ComponentDB,
  fileName: string,
): traverse.VisitNode<traverse.Node, t.MemberExpression> {
  return {
    enter(nodePath) {
      const { object, property } = nodePath.node;

      // this.props.foo
      if (
        t.isThisExpression(object) &&
        t.isIdentifier(property, { name: "props" }) &&
        nodePath.parentPath.isMemberExpression() &&
        nodePath.parentPath.node.object === nodePath.node &&
        !nodePath.parentPath.node.computed &&
        t.isIdentifier(nodePath.parentPath.node.property)
      ) {
        const propName = nodePath.parentPath.node.property.name;
        const file = componentDB.getFile(fileName);
        const loc = getStartLoc(nodePath.node);
        const component = file.var.findDeepestVariable(loc);

        if (component && isReactFunctionVariable(component)) {
          componentDB.comAddProp(loc, fileName, {
            id: `${component.id}:prop:${propName}`,
            name: propName,
            type: "any",
            kind: "prop",
          });
        }
      }
    },
  };
}
