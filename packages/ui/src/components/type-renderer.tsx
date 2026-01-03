import React, { type JSX } from "react";
import type { FuncParam, TypeData } from "shared";
import { TypeColors } from "./type-colors";
import { cn } from "@/lib/utils";
import type { NodeData, ComboData } from "../graph/hook";
import { TypeRefRenderer } from "./type-ref-renderer";

interface TypeRendererProps {
  type: TypeData | undefined;
  nodes: Record<string, NodeData> | undefined;
  combos: Record<string, ComboData> | undefined;
  depth?: number;
}

const FuncParamRenderer: React.FC<{
  param: FuncParam;
  nodes: Record<string, NodeData> | undefined;
  combos: Record<string, ComboData> | undefined;
  depth: number;
}> = ({ param, nodes, combos, depth }) => {
  // We need to import FuncParam or just use it. It's from shared.
  const p = param;

  switch (p.type) {
    case "named":
      return <span className={TypeColors.component}>{p.name}</span>;
    case "rest-element":
      return (
        <span>
          <span className={TypeColors.punctuation}>...</span>
          <span className={TypeColors.component}>{p.name}</span>
        </span>
      );
    case "object-pattern":
      return (
        <span>
          <span className={TypeColors.punctuation}>{"{"}</span>
          {p.property.map((prop, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className={TypeColors.punctuation}>, </span>}
              {prop.type === "object-property" ? (
                <span>
                  <span className={TypeColors.component}>{prop.key}</span>
                  {!prop.shorthand && (
                    <>
                      <span className={TypeColors.punctuation}>: </span>
                      <FuncParamRenderer
                        param={prop.value}
                        nodes={nodes}
                        combos={combos}
                        depth={depth}
                      />
                    </>
                  )}
                </span>
              ) : (
                <FuncParamRenderer
                  param={prop}
                  nodes={nodes}
                  combos={combos}
                  depth={depth}
                />
              )}
            </React.Fragment>
          ))}
          <span className={TypeColors.punctuation}>{"}"}</span>
        </span>
      );
    case "array-pattern":
      return (
        <span>
          <span className={TypeColors.punctuation}>{"["}</span>
          <span
            className={cn(
              "pl-4",
              p.elements.length >= 3 ? "flex flex-col" : ""
            )}
          >
            {p.elements.map((el, i) => (
              <span key={i}>
                <FuncParamRenderer
                  param={el}
                  nodes={nodes}
                  combos={combos}
                  depth={depth}
                />
                {i < p.elements.length - 1 && (
                  <span className={TypeColors.punctuation}>, </span>
                )}
              </span>
            ))}
          </span>
          <span className={TypeColors.punctuation}>{"]"}</span>
        </span>
      );
    default:
      return null;
  }
};

export const TypeRenderer: React.FC<TypeRendererProps> = ({
  type,
  nodes,
  combos,
  depth = 0,
}) => {
  if (!type) return <span className={TypeColors.default}>any</span>;

  // Prevent infinite recursion depth (optional safeguard)
  if (depth > 10) return <span className={TypeColors.punctuation}>...</span>;

  switch (type.type) {
    case "string":
    case "number":
    case "boolean":
    case "bigint":
    case "null":
    case "undefined":
    case "void":
    case "any":
    case "unknown":
    case "never":
      return <span className={TypeColors.keyword}>{type.type}</span>;

    case "literal-type": {
      const literal = type.literal;
      if (literal.type === "string")
        return <span className={TypeColors.string}>"{literal.value}"</span>;
      if (literal.type === "number")
        return <span className={TypeColors.number}>{literal.value}</span>;
      if (literal.type === "boolean")
        return (
          <span className={TypeColors.boolean}>{literal.value.toString()}</span>
        );
      if (literal.type == "bigint") {
        return <span className={TypeColors.number}>{literal.value}</span>;
      }
      if (literal.type === "template") {
        const template: JSX.Element[] = [];

        for (const [i, quasis] of literal.quasis.entries()) {
          template.push(
            <React.Fragment key={template.length}>{quasis}</React.Fragment>
          );

          if (i != literal.quasis.length - 1) {
            if (literal.expression.length - 1 < i) {
              console.error("index out of range");
              continue;
            }

            template.push(
              <React.Fragment key={template.length}>
                {"${"}
                <TypeRenderer
                  type={literal.expression[i]}
                  nodes={nodes}
                  combos={combos}
                  depth={depth + 1}
                />
                {"}"}
              </React.Fragment>
            );
          }
        }

        return <span className={TypeColors.string}>`{template}`</span>;
      }
      if (literal.type === "unary") {
        if (literal.argument.type == "number") {
          return (
            <span className={TypeColors.number}>
              {literal.prefix ? (
                <>
                  {literal.operator}
                  {literal.argument.value}
                </>
              ) : (
                <>
                  {literal.argument.value}
                  {literal.operator}
                </>
              )}
            </span>
          );
        }
      }
      return (
        <span className={TypeColors.literal}>{JSON.stringify(literal)}</span>
      );
    }

    case "array":
      return (
        <span>
          <TypeRenderer
            type={type.element}
            nodes={nodes}
            combos={combos}
            depth={depth}
          />
          <span className={TypeColors.punctuation}>[]</span>
        </span>
      );

    case "union":
      return (
        <span>
          {type.members.map((member, i) => (
            <React.Fragment key={i}>
              {i > 0 && (
                <span className={cn(TypeColors.punctuation, "mx-1")}>|</span>
              )}
              <TypeRenderer
                type={member}
                nodes={nodes}
                combos={combos}
                depth={depth}
              />
            </React.Fragment>
          ))}
        </span>
      );

    case "intersection":
      return (
        <span>
          {type.members.map((member, i) => (
            <React.Fragment key={i}>
              {i > 0 && (
                <span className={cn(TypeColors.punctuation, "mx-1")}>&</span>
              )}
              <TypeRenderer
                type={member}
                nodes={nodes}
                combos={combos}
                depth={depth}
              />
            </React.Fragment>
          ))}
        </span>
      );

    case "type-literal":
      return (
        <span>
          <span className={TypeColors.punctuation}>{"{"}</span>
          <div className="pl-4 flex flex-col">
            {type.members.map((member, i) => {
              if (member.signatureType === "property") {
                return (
                  <div key={i}>
                    <span className={TypeColors.component}>{member.name}</span>
                    {member.optional && (
                      <span className={TypeColors.punctuation}>?</span>
                    )}
                    <span className={TypeColors.punctuation}>: </span>
                    <TypeRenderer
                      type={member.type}
                      nodes={nodes}
                      combos={combos}
                      depth={depth + 1}
                    />
                    <span className={TypeColors.punctuation}>;</span>
                  </div>
                );
              }
              if (member.signatureType === "index") {
                return (
                  <div key={i}>
                    <span className={TypeColors.punctuation}>[</span>
                    <span className={TypeColors.component}>
                      {member.parameter.name}
                    </span>
                    <span className={TypeColors.punctuation}>: </span>
                    <TypeRenderer
                      type={member.parameter.type}
                      nodes={nodes}
                      combos={combos}
                      depth={depth + 1}
                    />
                    <span className={TypeColors.punctuation}>]: </span>
                    <TypeRenderer
                      type={member.type}
                      nodes={nodes}
                      combos={combos}
                      depth={depth + 1}
                    />
                    <span className={TypeColors.punctuation}>;</span>
                  </div>
                );
              }
              return null;
            })}
          </div>
          <span className={TypeColors.punctuation}>{"}"}</span>
        </span>
      );

    case "ref": {
      return <TypeRefRenderer type={type} nodes={nodes} combos={combos} />;
    }

    // Add other cases like 'parenthesis' as needed
    case "parenthesis":
      return (
        <span>
          <span className={TypeColors.punctuation}>(</span>
          <TypeRenderer
            type={type.members}
            nodes={nodes}
            combos={combos}
            depth={depth}
          />
          <span className={TypeColors.punctuation}>)</span>
        </span>
      );

    case "tuple":
      return (
        <span className={TypeColors.punctuation}>
          <span className={TypeColors.punctuation}>[</span>
          {type.elements.map((element, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className={TypeColors.punctuation}>, </span>}
              {element.type == "named" && (
                <>
                  <span className={TypeColors.component}>{element.name}</span>
                  <span>{`${element.optional ? "?" : ""}: `}</span>
                </>
              )}
              <TypeRenderer
                type={element.typeData}
                nodes={nodes}
                combos={combos}
                depth={depth}
              />
            </React.Fragment>
          ))}
          <span className={TypeColors.punctuation}>]</span>
        </span>
      );
    case "function":
      return (
        <span>
          {type.params && type.params.length > 0 && (
            <span className={TypeColors.punctuation}>
              {"<"}
              {type.params.map((p, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <span className={TypeColors.punctuation}>, </span>}
                  <span className={TypeColors.component}>{p.name}</span>
                  {p.constraint && (
                    <>
                      <span className={cn(TypeColors.punctuation, " mx-1")}>
                        extends
                      </span>
                      <TypeRenderer
                        type={p.constraint}
                        nodes={nodes}
                        combos={combos}
                        depth={depth + 1}
                      />
                    </>
                  )}
                  {p.default && (
                    <>
                      <span className={cn(TypeColors.punctuation, " mx-1")}>
                        =
                      </span>
                      <TypeRenderer
                        type={p.default}
                        nodes={nodes}
                        combos={combos}
                        depth={depth + 1}
                      />
                    </>
                  )}
                </React.Fragment>
              ))}
              {">"}
            </span>
          )}
          <span className={TypeColors.punctuation}>(</span>
          <span
            className={cn(
              type.parameters.length >= 3 ? "pl-4 flex flex-col" : ""
            )}
          >
            {type.parameters.map((param, i) => (
              <span key={i}>
                <FuncParamRenderer
                  param={param.param}
                  nodes={nodes}
                  combos={combos}
                  depth={depth}
                />
                {param.optional ? (
                  <span className={TypeColors.punctuation}>?</span>
                ) : undefined}
                {param.typeData && (
                  <>
                    <span className={TypeColors.punctuation}>: </span>
                    <TypeRenderer
                      type={param.typeData}
                      nodes={nodes}
                      combos={combos}
                      depth={depth}
                    />
                  </>
                )}
                {i < type.parameters.length - 1 && (
                  <span className={TypeColors.punctuation}>, </span>
                )}
              </span>
            ))}
          </span>
          <span className={TypeColors.punctuation}>)</span>
          <span className={TypeColors.punctuation}>{" => "}</span>
          <TypeRenderer
            type={type.return}
            nodes={nodes}
            combos={combos}
            depth={depth}
          />
        </span>
      );
    case "index-access":
      return (
        <span>
          <TypeRenderer
            type={type.objectType}
            nodes={nodes}
            combos={combos}
            depth={depth}
          />
          <span className={TypeColors.punctuation}>{"["}</span>
          <TypeRenderer
            type={type.indexType}
            nodes={nodes}
            combos={combos}
            depth={depth}
          />
          <span className={TypeColors.punctuation}>{"]"}</span>
        </span>
      );
    default:
      return (
        <span className={TypeColors.default}>
          {(type as { type: string }).type}
        </span>
      );
  }
};
