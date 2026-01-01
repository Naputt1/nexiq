import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

import { TypeRenderer } from "./type-renderer";
import type { PropData, TypeDataParam } from "shared";
import type { ComboData, NodeData } from "@/graph/hook";
import { TypeRefRenderer } from "./type-ref-renderer";
import React from "react";

interface NodeDetailsProps {
  selectedId: string | null;
  nodes: Record<string, NodeData>;
  combos: Record<string, ComboData>;
  onClose: () => void;
}

export function NodeDetails({
  selectedId,
  nodes,
  combos,
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
      <span className="text-gray-400 pr-1">
        {"<"}
        {params.map((p, i) => (
          <span key={i}>
            {i > 0 && ", "}
            <span className="text-yellow-200">{p.name}</span>
            {p.constraint && (
              <>
                <span className="text-purple-400"> extends </span>
                <TypeRenderer
                  type={p.constraint}
                  nodes={nodes}
                  combos={combos}
                />
              </>
            )}
            {p.default && (
              <>
                <span className="text-purple-400"> = </span>
                <TypeRenderer type={p.default} nodes={nodes} combos={combos} />
              </>
            )}
          </span>
        ))}
        {">"}
      </span>
    );
  };

  return (
    <Card className="absolute top-4 left-4 w-96 shadow-lg z-50 bg-[#2d2d2d] border-[#454545] text-white overflow-hidden flex flex-col max-h-[90vh]">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 p-4 pb-2 shrink-0">
        <div className="flex flex-col gap-1 overflow-hidden">
          <CardTitle className="text-xs font-medium text-gray-400 uppercase tracking-wider text-start">
            {item.type || type}
          </CardTitle>
          <div className="text-lg font-bold flex items-center gap-1 truncate">
            <span className="text-blue-300">{item.label?.text}</span>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-8 w-8 text-gray-400 hover:text-white shrink-0"
        >
          <X className="h-5 w-5" />
        </Button>
      </CardHeader>
      <CardContent className="p-4 pt-2 text-sm space-y-3 overflow-y-auto">
        <div className="space-y-1">
          <div className="flex gap-2 text-xs">
            <span className="font-semibold text-gray-500 min-w-12">ID:</span>
            <span className="truncate text-gray-400" title={item.id}>
              {item.id}
            </span>
          </div>

          {item.fileName && (
            <div className="flex gap-2 text-xs">
              <span className="font-semibold text-gray-500 min-w-12">
                File:
              </span>
              <span className="text-gray-400 break-all">{item.fileName}</span>
            </div>
          )}
        </div>

        {(item.propType || (item.props && item.props.length > 0)) && (
          <div className="mt-4 pt-4 border-t border-[#454545]">
            <div className="flex items-center gap-2 mb-2">
              <span className="font-semibold text-gray-400">
                {type === "Node" ? "Definition" : "Properties"}
              </span>
            </div>
            <div className="text-xs font-mono bg-[#1e1e1e] p-3 rounded-md border border-[#333] max-w-full overflow-x-auto text-start leading-relaxed shadow-inner">
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
                          nodes={nodes}
                          combos={combos}
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
                <TypeRenderer
                  type={item.propType}
                  nodes={nodes}
                  combos={combos}
                />
              ) : (
                item.props?.map((p: PropData, i: number) => (
                  <div
                    key={i}
                    className="flex justify-between py-0.5 border-b border-[#2a2a2a] last:border-0"
                  >
                    <span className="text-blue-300">{p.name}</span>
                    <span className="text-gray-500 italic">{p.type}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
