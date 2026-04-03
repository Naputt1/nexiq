import * as t from "@babel/types";
import type traverse from "@babel/traverse";
import type { ComponentDB } from "../db/componentDB.ts";
import { getPattern } from "./pattern.ts";
import type { ComponentFileVar, DistributiveOmit } from "@nexiq/shared";
import { extractStateKeys, getStartLoc } from "./classDeclaration.ts";
import { isClassComponentVariable } from "../db/variable/type.ts";

export default function ClassProperty(
  componentDB: ComponentDB,
  fileName: string,
): traverse.VisitNode<traverse.Node, t.ClassProperty | t.ClassPrivateProperty> {
  return {
    enter(nodePath) {
      const node = nodePath.node;
      const isPrivate = t.isClassPrivateProperty(node);

      const loc = {
        line: node.key.loc!.start.line,
        column: node.key.loc!.start.column,
      };

      const pattern = isPrivate
        ? getPattern((node as t.ClassPrivateProperty).key.id as t.LVal)
        : getPattern((node as t.ClassProperty).key as t.LVal);

      const isState = !isPrivate && t.isIdentifier(node.key, { name: "state" });
      const kind = isState ? "state" : "property";

      const id = componentDB.addVariable(
        fileName,
        {
          name: pattern,
          dependencies: {},
          type: "data",
          loc,
          isStatic: !isPrivate && (node as t.ClassProperty).static,
          memberKind: isPrivate ? "private-property" : "property",
        } as DistributiveOmit<
          ComponentFileVar,
          "id" | "kind" | "var" | "children" | "file" | "hash" | "components"
        >,
        kind,
      );

      if (isState) {
        const file = componentDB.getFile(fileName);
        const component = file.var.findDeepestVariable(loc);

        if (component && isClassComponentVariable(component)) {
          const keys = extractStateKeys(
            (node as t.ClassProperty).value as any,
            nodePath.scope,
          );
          for (const keyInfo of keys) {
            componentDB.addStateVariable(
              fileName,
              component.id,
              keyInfo.name,
              getStartLoc((node as t.ClassProperty).key),
              keyInfo.type,
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
      const isPrivate = t.isClassPrivateProperty(node);

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
