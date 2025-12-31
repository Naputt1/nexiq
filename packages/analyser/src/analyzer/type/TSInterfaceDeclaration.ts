import * as t from "@babel/types";
import traverse from "@babel/traverse";
import type { TypeDataDeclareInterface, TypeDataParam } from "shared";
import assert from "assert";
import type { ComponentDB } from "../../db/componentDB.js";
import type { TypeDataLiteralBody } from "shared/src/types/primitive.js";
import { getType } from "./helper.js";

export default function TSInterfaceDeclaration(
  componentDB: ComponentDB,
  fileName: string
): traverse.VisitNode<traverse.Node, t.TSInterfaceDeclaration> {
  return (nodePath) => {
    const name = nodePath.node.id.name;
    assert(nodePath.node.id.loc != null);

    const loc = {
      line: nodePath.node.id.loc.start.line,
      column: nodePath.node.id.loc.start.column,
    };

    const bodies: TypeDataLiteralBody[] = [];

    for (const b of nodePath.node.body.body) {
      if (b.type === "TSPropertySignature") {
        assert(b.key.type == "Identifier");
        assert(b.typeAnnotation?.type == "TSTypeAnnotation");

        const body: TypeDataLiteralBody = {
          signatureType: "property",
          name: b.key.name,
          type: getType(b.typeAnnotation.typeAnnotation),
        };

        if (b.optional) {
          body.optional = true;
        }

        if (b.computed) {
          body.computed = true;
        }

        bodies.push(body);
      } else if (b.type === "TSIndexSignature") {
        assert(b.typeAnnotation?.type == "TSTypeAnnotation");
        assert(b.parameters.length == 1);
        assert(b.parameters[0]!.typeAnnotation?.type == "TSTypeAnnotation");

        bodies.push({
          signatureType: "index",
          type: getType(b.typeAnnotation.typeAnnotation),
          parameter: {
            name: b.parameters[0]!.name,
            type: getType(b.parameters[0]!.typeAnnotation.typeAnnotation),
          },
        });
      } else {
        debugger;
      }
    }

    const typeData: Omit<TypeDataDeclareInterface, "id"> = {
      type: "interface",
      name,
      body: bodies,
      loc,
    };

    if (nodePath.node.extends) {
      typeData.extends = [];
      for (const ex of nodePath.node.extends) {
        assert(ex.expression.type == "Identifier");

        typeData.extends.push(ex.expression.name);
      }
    }

    if (nodePath.node.typeParameters) {
      typeData.params = {};
      for (const param of nodePath.node.typeParameters.params) {
        const dataParam: TypeDataParam = {
          name: param.name,
        };

        if (param.constraint) {
          dataParam.constraint = getType(param.constraint);
        }

        if (param.default) {
          dataParam.default = getType(param.default);
        }

        typeData.params[dataParam.name] = dataParam;
      }
    }

    componentDB.fileAddTsTypes(fileName, typeData);
  };
}
