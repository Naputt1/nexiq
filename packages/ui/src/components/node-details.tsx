import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

import { TypeRenderer } from "./type-renderer";
import type {
  ComponentInfoRenderDependency,
  PropData,
  TypeDataDeclare,
  TypeDataParam,
} from "shared";
import type { ComboData, NodeData } from "@/graph/hook";
import { TypeRefRenderer } from "./type-ref-renderer";
import React from "react";

interface NodeDetailsProps {
  selectedId: string | null;
  nodes: Record<string, NodeData>;
  combos: Record<string, ComboData>;
  typeData: Record<string, TypeDataDeclare>;
  onClose: () => void;
}

export function NodeDetails({
  selectedId,
  nodes,
  combos,
  typeData,
  onClose,
}: NodeDetailsProps) {
  if (!selectedId) return null;

  const item: NodeData | ComboData | undefined =
    nodes[selectedId] || combos[selectedId];

  if (!item) return null;

  const type = nodes[selectedId] ? "Node" : "Combo";

  const renderGenerics = (params?: TypeDataParam[]) => {
    if (!params || params.length === 0) return null;
    return (
      <span className="text-muted-foreground pr-1">
        {"<"}
        {params.map((p, i) => (
          <span key={i}>
            {i > 0 && ", "}
            <span className="text-yellow-200">{p.name}</span>
            {p.constraint && (
              <>
                <span className="text-purple-400"> extends </span>
                <TypeRenderer type={p.constraint} typeData={typeData} />
              </>
            )}
            {p.default && (
              <>
                <span className="text-purple-400"> = </span>
                <TypeRenderer type={p.default} typeData={typeData} />
              </>
            )}
          </span>
        ))}
        {">"}
      </span>
    );
  };

  return (
    <Card className="absolute top-4 left-16 w-96 shadow-lg z-50 bg-popover border-border text-foreground overflow-hidden flex flex-col max-h-[90vh]">
      <CardHeader className="flex flex-row justify-between space-y-0 p-4 pb-2 shrink-0">
        <div className="flex flex-col gap-1 overflow-hidden">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider text-start">
            {item.type || type}
          </CardTitle>
          <div className="text-lg font-bold flex items-center gap-1 truncate">
            <span className="text-primary">{item.label?.text}</span>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
        >
          <X className="h-5 w-5" />
        </Button>
      </CardHeader>
      <CardContent className="p-4 pt-2 text-sm space-y-3 overflow-y-auto">
        <div className="space-y-1">
          <div className="flex gap-2 text-xs">
            <span className="font-semibold text-muted-foreground/80 min-w-12">
              ID:
            </span>
            <span className="truncate text-muted-foreground" title={item.id}>
              {item.id}
            </span>
          </div>

          {item.fileName && (
            <div className="flex gap-2 text-xs">
              <span className="font-semibold text-muted-foreground/80 min-w-12">
                File:
              </span>
              <span className="text-muted-foreground break-all">
                {item.fileName}
              </span>
            </div>
          )}
        </div>

        {(item.propType || (item.props && item.props.length > 0)) && (
          <div className="mt-4 pt-4 border-t border-border">
            <div className="flex items-center gap-2 mb-2">
              <span className="font-semibold text-muted-foreground">
                {item.type === "component" ? "Props" : "Definition"}
              </span>
            </div>
            <div className="text-xs font-mono bg-muted/50 p-3 rounded-md border border-border max-w-full overflow-x-auto text-start leading-relaxed shadow-inner">
              {renderGenerics(item.typeParams)}
              {item.extends && (
                <span className="text-purple-400">
                  {"extends "}
                  {item.extends.map((param, i) => {
                    return (
                      <React.Fragment key={i}>
                        <TypeRefRenderer
                          key={i}
                          type={{
                            type: "ref",
                            refType: "named",
                            name: param,
                          }}
                          typeData={typeData}
                        />
                        {item.extends!.length - 1 > i && (
                          <span className="text-gray-400">,</span>
                        )}{" "}
                      </React.Fragment>
                    );
                  })}
                </span>
              )}
              {item.propType ? (
                <TypeRenderer type={item.propType} typeData={typeData} />
              ) : (
                item.props?.map((p: PropData, i: number) => (
                  <div
                    key={i}
                    className="flex justify-between py-0.5 border-b border-border/50 last:border-0"
                  >
                    <span className="text-primary">
                      {p.kind === "spread" ? "..." : ""}
                      {p.name}
                    </span>
                    <span className="text-muted-foreground italic">
                      {p.type}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {item.type === "component" && (
          <div className="mt-4 pt-4 border-t border-border">
            <div className="flex items-center gap-2 mb-2">
              <span className="font-semibold text-muted-foreground">
                Renders
              </span>
            </div>

            <div className="space-y-4">
              {Object.values(nodes)

                .filter((n) => n.combo === selectedId + "-render")

                .map((v) => {
                  const renders = item.renders;

                  const renderId = v.id.slice(
                    (selectedId! + "-render-").length,
                  );

                  const render = renders?.[renderId];

                  if (!render) return null;

                  return (
                    <div
                      key={v.id}
                      className="text-xs font-mono bg-muted/30 p-2 rounded border border-border/50"
                    >
                      <div className="font-bold text-primary mb-1">
                        {v.label?.text}
                      </div>

                      <div className="space-y-1">
                        {render.dependencies.map(
                          (dep: ComponentInfoRenderDependency, j: number) => (
                            <div key={j} className="flex gap-2">
                              <span className="text-yellow-200/80">
                                {dep.name}:
                              </span>

                              <span className="text-muted-foreground italic">
                                <TypeRenderer
                                  type={dep.value}
                                  typeData={typeData}
                                />
                              </span>
                            </div>
                          ),
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
