import React, { type JSX } from "react";
import type { FuncParam, TypeData, TypeDataDeclare } from "shared";
import { TypeColors } from "./type-colors";
import { cn } from "@/lib/utils";
import { TypeRefRenderer } from "./type-ref-renderer";

interface TypeRendererProps {
  type: TypeData | undefined;
  typeData: Record<string, TypeDataDeclare>;
  depth?: number;
}

const FuncParamRenderer: React.FC<{
  param: FuncParam;
  typeData: Record<string, TypeDataDeclare>;
  depth: number;
}> = ({ param, typeData, depth }) => {
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
                        typeData={typeData}
                        depth={depth}
                      />
                    </>
                  )}
                </span>
              ) : (
                <FuncParamRenderer
                  param={prop}
                  typeData={typeData}
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
              p.elements.length >= 3 ? "flex flex-col" : "",
            )}
          >
            {p.elements.map((el, i) => (
              <span key={i}>
                <FuncParamRenderer
                  param={el}
                  typeData={typeData}
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
  typeData,
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
            <React.Fragment key={template.length}>{quasis}</React.Fragment>,
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
                  typeData={typeData}
                  depth={depth + 1}
                />
                {"}"}
              </React.Fragment>,
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

    case "literal-array":
      return (
        <span>
          <span className={TypeColors.punctuation}>[</span>
          {type.elements.map((el, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className={TypeColors.punctuation}>, </span>}
              <TypeRenderer type={el} typeData={typeData} depth={depth} />
            </React.Fragment>
          ))}
          <span className={TypeColors.punctuation}>]</span>
        </span>
      );

    case "literal-object":
      return (
        <span>
          <span className={TypeColors.punctuation}>{"{"}</span>
          {Object.entries(type.properties).map(([key, val], i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className={TypeColors.punctuation}>, </span>}
              <span className={TypeColors.component}>{key}</span>
              <span className={TypeColors.punctuation}>: </span>
              <TypeRenderer type={val} typeData={typeData} depth={depth + 1} />
            </React.Fragment>
          ))}
          <span className={TypeColors.punctuation}>{"}"}</span>
        </span>
      );

    case "array":
      return (
        <span>
          <TypeRenderer type={type.element} typeData={typeData} depth={depth} />
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
              <TypeRenderer type={member} typeData={typeData} depth={depth} />
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
              <TypeRenderer type={member} typeData={typeData} depth={depth} />
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
                      typeData={typeData}
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
                      typeData={typeData}
                      depth={depth + 1}
                    />
                    <span className={TypeColors.punctuation}>]: </span>
                    <TypeRenderer
                      type={member.type}
                      typeData={typeData}
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
      return <TypeRefRenderer type={type} typeData={typeData} />;
    }

    // Add other cases like 'parenthesis' as needed
    case "parenthesis":
      return (
        <span>
          <span className={TypeColors.punctuation}>(</span>
          <TypeRenderer type={type.members} typeData={typeData} depth={depth} />
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
                typeData={typeData}
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
                        typeData={typeData}
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
                        typeData={typeData}
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
              type.parameters.length >= 3 ? "pl-4 flex flex-col" : "",
            )}
          >
            {type.parameters.map((param, i) => (
              <span key={i}>
                <FuncParamRenderer
                  param={param.param}
                  typeData={typeData}
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
                      typeData={typeData}
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
          <TypeRenderer type={type.return} typeData={typeData} depth={depth} />
        </span>
      );
    case "index-access":
      return (
        <span>
          <TypeRenderer
            type={type.objectType}
            typeData={typeData}
            depth={depth}
          />
          <span className={TypeColors.punctuation}>{"["}</span>
          <TypeRenderer
            type={type.indexType}
            typeData={typeData}
            depth={depth}
          />
          <span className={TypeColors.punctuation}>{"]"}</span>
        </span>
      );
    case "query":
      return (
        <span>
          <span className={TypeColors.punctuation}>{"typeof "}</span>
          <TypeRenderer type={type.expr} typeData={typeData} depth={depth} />
        </span>
      );
    case "import":
      return (
        <span>
          <span className={TypeColors.punctuation}>{"import("}</span>
          <span className={TypeColors.component}>"{type.name}"</span>
          <span className={TypeColors.punctuation}>{")"}</span>
          {type.qualifier && (
            <span className={TypeColors.punctuation}>
              {`.${type.qualifier}`}
            </span>
          )}
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
