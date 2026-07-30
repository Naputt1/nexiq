import * as t from "@babel/types";
import type traverse from "@babel/traverse";
import type { ComponentDB } from "../db/componentDB.ts";
import { getPattern } from "./pattern.ts";

function toScope(node: t.Node) {
  if (!node.loc) return null;
  return {
    start: {
      line: node.loc.start.line,
      column: node.loc.start.column,
    },
    end: {
      line: node.loc.end.line,
      column: node.loc.end.column,
    },
  };
}

function registerCatchParam(
  componentDB: ComponentDB,
  fileName: string,
  p: t.LVal,
) {
  const loc = {
    line: p.loc!.start.line,
    column: p.loc!.start.column,
  };

  componentDB.addVariable(
    fileName,
    {
      name: getPattern(p),
      dependencies: {},
      type: "data",
      loc,
    },
    "normal",
    "let",
  );
}

export default function BlockScope(componentDB: ComponentDB, fileName: string) {
  const addScope = (node: t.Node | null | undefined) => {
    if (!node) return;
    const scope = toScope(node);
    if (!scope) return;
    componentDB.addBlockScope(fileName, scope);
  };

  return {
    BlockStatement: {
      enter(nodePath: traverse.NodePath<t.BlockStatement>) {
        const parent = nodePath.parentPath;
        if (
          parent.isFunctionDeclaration() ||
          parent.isFunctionExpression() ||
          parent.isArrowFunctionExpression() ||
          parent.isClassMethod() ||
          parent.isClassPrivateMethod() ||
          parent.isObjectMethod() ||
          parent.isProgram()
        ) {
          return;
        }

        addScope(nodePath.node);
      },
    },
    SwitchStatement: {
      enter(nodePath: traverse.NodePath<t.SwitchStatement>) {
        addScope(nodePath.node);
      },
    },
    ForStatement: {
      enter(nodePath: traverse.NodePath<t.ForStatement>) {
        addScope(nodePath.node);
      },
    },
    ForInStatement: {
      enter(nodePath: traverse.NodePath<t.ForInStatement>) {
        addScope(nodePath.node);
      },
    },
    ForOfStatement: {
      enter(nodePath: traverse.NodePath<t.ForOfStatement>) {
        addScope(nodePath.node);
      },
    },
    WhileStatement: {
      enter(nodePath: traverse.NodePath<t.WhileStatement>) {
        addScope(nodePath.node);
      },
    },
    DoWhileStatement: {
      enter(nodePath: traverse.NodePath<t.DoWhileStatement>) {
        addScope(nodePath.node);
      },
    },
    CatchClause: {
      enter(nodePath: traverse.NodePath<t.CatchClause>) {
        addScope(nodePath.node);

        const param = nodePath.node.param;
        if (!param) return;

        if (t.isIdentifier(param)) {
          registerCatchParam(componentDB, fileName, param);
        } else if (t.isObjectPattern(param)) {
          for (const prop of param.properties) {
            if (t.isRestElement(prop)) {
              registerCatchParam(componentDB, fileName, prop.argument);
            } else if (t.isObjectProperty(prop)) {
              const val = prop.value;
              if (
                t.isIdentifier(val) ||
                t.isObjectPattern(val) ||
                t.isArrayPattern(val)
              ) {
                registerCatchParam(componentDB, fileName, val);
              }
            }
          }
        } else if (t.isArrayPattern(param)) {
          for (const el of param.elements) {
            if (el) {
              if (t.isRestElement(el)) {
                registerCatchParam(componentDB, fileName, el.argument);
              } else if (
                t.isIdentifier(el) ||
                t.isObjectPattern(el) ||
                t.isArrayPattern(el)
              ) {
                registerCatchParam(componentDB, fileName, el);
              }
            }
          }
        }
      },
    },
    StaticBlock: {
      enter(nodePath: traverse.NodePath<t.StaticBlock>) {
        addScope(nodePath.node);
      },
    },
  };
}
