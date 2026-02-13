import React, { type JSX } from "react";
import type { FuncParam, TypeData, TypeDataDeclare } from "shared";
import { TypeColorClasses } from "./type-colors";
import { cn } from "@/lib/utils";
import { TypeRefRenderer } from "./type-ref-renderer";
import { useConfigStore } from "@/hooks/use-config-store";
import type { CustomColors } from "../../electron/types";

interface TypeRendererProps {
  type: TypeData | undefined;
  typeData: Record<string, TypeDataDeclare>;
  depth?: number;
}

const FuncParamRenderer: React.FC<{
  param: FuncParam;
  typeData: Record<string, TypeDataDeclare>;
  depth: number;
  getStyle: (key: keyof typeof TypeColorClasses) => { className: string; style: React.CSSProperties };
}> = ({ param, typeData, depth, getStyle }) => {
  const p = param;

  switch (p.type) {
    case "named":
      return <span {...getStyle("typeComponent")}>{p.name}</span>;
    case "rest-element":
      return (
        <span>
          <span {...getStyle("typePunctuation")}>...</span>
          <span {...getStyle("typeComponent")}>{p.name}</span>
        </span>
      );
    case "object-pattern":
      return (
        <span>
          <span {...getStyle("typePunctuation")}>{"{"}</span>
          {p.property.map((prop, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span {...getStyle("typePunctuation")}>, </span>}
              {prop.type === "object-property" ? (
                <span>
                  <span {...getStyle("typeComponent")}>{prop.key}</span>
                  {!prop.shorthand && (
                    <>
                      <span {...getStyle("typePunctuation")}>: </span>
                      <FuncParamRenderer
                        param={prop.value}
                        typeData={typeData}
                        depth={depth}
                        getStyle={getStyle}
                      />
                    </>
                  )}
                </span>
              ) : (
                <FuncParamRenderer
                  param={prop}
                  typeData={typeData}
                  depth={depth}
                  getStyle={getStyle}
                />
              )}
            </React.Fragment>
          ))}
          <span {...getStyle("typePunctuation")}>{"}"}</span>
        </span>
      );
    case "array-pattern":
      return (
        <span>
          <span {...getStyle("typePunctuation")}>{"["}</span>
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
                  getStyle={getStyle}
                />
                {i < p.elements.length - 1 && (
                  <span {...getStyle("typePunctuation")}>, </span>
                )}
              </span>
            ))}
          </span>
          <span {...getStyle("typePunctuation")}>{"]"}</span>
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
  const { customColors } = useConfigStore();

  const getStyle = (key: keyof typeof TypeColorClasses) => {
    const custom = customColors[key as keyof CustomColors];
    return {
      className: custom ? "" : TypeColorClasses[key],
      style: custom ? { color: custom } : {},
    };
  };

  if (!type) return <span {...getStyle("typeDefault")}>any</span>;

  // Prevent infinite recursion depth (optional safeguard)
  if (depth > 10) return <span {...getStyle("typePunctuation")}>...</span>;

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
      return <span {...getStyle("typeKeyword")}>{type.type}</span>;

    case "literal-type": {
      const literal = type.literal;
      if (literal.type === "string")
        return <span {...getStyle("typeString")}>"{literal.value}"</span>;
      if (literal.type === "number")
        return <span {...getStyle("typeNumber")}>{literal.value}</span>;
      if (literal.type === "boolean")
        return (
          <span {...getStyle("typeBoolean")}>
            {literal.value.toString()}
          </span>
        );
      if (literal.type == "bigint") {
        return <span {...getStyle("typeNumber")}>{literal.value}</span>;
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

        return <span {...getStyle("typeString")}>`{template}`</span>;
      }
      if (literal.type === "unary") {
        if (literal.argument.type == "number") {
          return (
            <span {...getStyle("typeNumber")}>
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
        <span {...getStyle("typeLiteral")}>{JSON.stringify(literal)}</span>
      );
    }

    case "literal-array":
      return (
        <span>
          <span {...getStyle("typePunctuation")}>[</span>
          {type.elements.map((el, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span {...getStyle("typePunctuation")}>, </span>}
              <TypeRenderer type={el} typeData={typeData} depth={depth} />
            </React.Fragment>
          ))}
          <span {...getStyle("typePunctuation")}>]</span>
        </span>
      );

    case "literal-object":
      return (
        <span>
          <span {...getStyle("typePunctuation")}>{"{"}</span>
          {Object.entries(type.properties).map(([key, val], i) => (
            <React.Fragment key={i}>
              {i > 0 && <span {...getStyle("typePunctuation")}>, </span>}
              <span {...getStyle("typeComponent")}>{key}</span>
              <span {...getStyle("typePunctuation")}>: </span>
              <TypeRenderer type={val} typeData={typeData} depth={depth + 1} />
            </React.Fragment>
          ))}
          <span {...getStyle("typePunctuation")}>{"}"}</span>
        </span>
      );

    case "array":
      return (
        <span>
          <TypeRenderer type={type.element} typeData={typeData} depth={depth} />
          <span {...getStyle("typePunctuation")}>[]</span>
        </span>
      );

    case "union":
      return (
        <span>
          {type.members.map((member, i) => (
            <React.Fragment key={i}>
              {i > 0 && (
                <span
                  {...getStyle("typePunctuation")}
                  className={cn(getStyle("typePunctuation").className, "mx-1")}
                >
                  |
                </span>
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
                <span
                  {...getStyle("typePunctuation")}
                  className={cn(getStyle("typePunctuation").className, "mx-1")}
                >
                  &
                </span>
              )}
              <TypeRenderer type={member} typeData={typeData} depth={depth} />
            </React.Fragment>
          ))}
        </span>
      );

    case "type-literal":
      return (
        <span>
          <span {...getStyle("typePunctuation")}>{"{"}</span>
          <div className="pl-4 flex flex-col">
            {type.members.map((member, i) => {
              if (member.signatureType === "property") {
                return (
                  <div key={i}>
                    <span {...getStyle("typeComponent")}>{member.name}</span>
                    {member.optional && (
                      <span {...getStyle("typePunctuation")}>?</span>
                    )}
                    <span {...getStyle("typePunctuation")}>: </span>
                    <TypeRenderer
                      type={member.type}
                      typeData={typeData}
                      depth={depth + 1}
                    />
                    <span {...getStyle("typePunctuation")}>;</span>
                  </div>
                );
              }
              if (member.signatureType === "index") {
                return (
                  <div key={i}>
                    <span {...getStyle("typePunctuation")}>[</span>
                    <span {...getStyle("typeComponent")}>
                      {member.parameter.name}
                    </span>
                    <span {...getStyle("typePunctuation")}>: </span>
                    <TypeRenderer
                      type={member.parameter.type}
                      typeData={typeData}
                      depth={depth + 1}
                    />
                    <span {...getStyle("typePunctuation")}>]: </span>
                    <TypeRenderer
                      type={member.type}
                      typeData={typeData}
                      depth={depth + 1}
                    />
                    <span {...getStyle("typePunctuation")}>;</span>
                  </div>
                );
              }
              return null;
            })}
          </div>
          <span {...getStyle("typePunctuation")}>{"}"}</span>
        </span>
      );

    case "ref": {
      return <TypeRefRenderer type={type} typeData={typeData} />;
    }

    // Add other cases like 'parenthesis' as needed
    case "parenthesis":
      return (
        <span>
          <span {...getStyle("typePunctuation")}>(</span>
          <TypeRenderer type={type.members} typeData={typeData} depth={depth} />
          <span {...getStyle("typePunctuation")}>)</span>
        </span>
      );

    case "tuple":
      return (
        <span {...getStyle("typePunctuation")}>
          <span {...getStyle("typePunctuation")}>[</span>
          {type.elements.map((element, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span {...getStyle("typePunctuation")}>, </span>}
              {element.type == "named" && (
                <>
                  <span {...getStyle("typeComponent")}>{element.name}</span>
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
          <span {...getStyle("typePunctuation")}>]</span>
        </span>
      );
    case "function":
      return (
        <span>
          {type.params && type.params.length > 0 && (
            <span {...getStyle("typePunctuation")}>
              {"<"}
              {type.params.map((p, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <span {...getStyle("typePunctuation")}>, </span>}
                  <span {...getStyle("typeComponent")}>{p.name}</span>
                  {p.constraint && (
                    <>
                      <span
                        {...getStyle("typePunctuation")}
                        className={cn(
                          getStyle("typePunctuation").className,
                          " mx-1",
                        )}
                      >
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
                      <span
                        {...getStyle("typePunctuation")}
                        className={cn(
                          getStyle("typePunctuation").className,
                          " mx-1",
                        )}
                      >
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
          <span {...getStyle("typePunctuation")}>(</span>
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
                  getStyle={getStyle}
                />
                {param.optional ? (
                  <span {...getStyle("typePunctuation")}>?</span>
                ) : undefined}
                {param.typeData && (
                  <>
                    <span {...getStyle("typePunctuation")}>: </span>
                    <TypeRenderer
                      type={param.typeData}
                      typeData={typeData}
                      depth={depth}
                    />
                  </>
                )}
                {i < type.parameters.length - 1 && (
                  <span {...getStyle("typePunctuation")}>, </span>
                )}
              </span>
            ))}
          </span>
          <span {...getStyle("typePunctuation")}>)</span>
          <span {...getStyle("typePunctuation")}>{" => "}</span>
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
          <span {...getStyle("typePunctuation")}>{"["}</span>
          <TypeRenderer
            type={type.indexType}
            typeData={typeData}
            depth={depth}
          />
          <span {...getStyle("typePunctuation")}>{"]"}</span>
        </span>
      );
    case "query":
      return (
        <span>
          <span {...getStyle("typePunctuation")}>{"typeof "}</span>
          <TypeRenderer type={type.expr} typeData={typeData} depth={depth} />
        </span>
      );
    case "import":
      return (
        <span>
          <span {...getStyle("typePunctuation")}>{"import("}</span>
          <span {...getStyle("typeComponent")}>"{type.name}"</span>
          <span {...getStyle("typePunctuation")}>{")"}</span>
          {type.qualifier && (
            <span {...getStyle("typePunctuation")}>
              {`.${type.qualifier}`}
            </span>
          )}
        </span>
      );
    default:
      return (
        <span {...getStyle("typeDefault")}>
          {(type as { type: string }).type}
        </span>
      );
  }
};
