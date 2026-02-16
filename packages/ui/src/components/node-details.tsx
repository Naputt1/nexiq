import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { X, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";

import { TypeRenderer } from "./type-renderer";
import {
  type ComponentInfoRenderDependency,
  type PropData,
  type TypeDataDeclare,
  type TypeDataParam,
  getDisplayName,
} from "shared";
import type { GraphComboData, GraphNodeData, GraphData } from "@/graph/hook";
import { TypeRefRenderer } from "./type-ref-renderer";
import React, { useEffect } from "react";
import { useGitStore } from "@/hooks/useGitStore";
import { useAppStateStore } from "@/hooks/use-app-state-store";
import { GitDiffView } from "./GitDiffView";
import { cn } from "@/lib/utils";
import { useConfigStore } from "@/hooks/use-config-store";

interface NodeDetailsProps {
  selectedId: string | null;
  item: GraphNodeData | GraphComboData | undefined;
  renderNodes: GraphNodeData[];
  typeData: Record<string, TypeDataDeclare>;
  projectPath: string;
  onClose: () => void;
  onSelect?: (id: string) => void;
  graph: GraphData;
}

export function NodeDetails({
  selectedId,
  item,
  renderNodes,
  typeData,
  projectPath,
  onClose,
  onSelect,
  graph,
}: NodeDetailsProps) {
  const diffs = useGitStore((s) => s.diffs);
  const loadDiff = useGitStore((s) => s.loadDiff);
  const selectedCommit = useAppStateStore((s) => s.selectedCommit);

  const { customColors } = useConfigStore();

  useEffect(() => {
    if (item?.gitStatus && item.pureFileName) {
      loadDiff(projectPath, {
        file: item.pureFileName,
        commit: selectedCommit || undefined,
      });
    }
  }, [
    item?.id,
    item?.gitStatus,
    item?.pureFileName,
    projectPath,
    selectedCommit,
    loadDiff,
  ]);

  if (!selectedId || !item) return null;

  const type =
    item.type ||
    (Object.prototype.hasOwnProperty.call(item, "collapsedRadius")
      ? "Combo"
      : "Node");

  const diffKey = `${selectedCommit || "current"}-${"working"}-${item.pureFileName || "all"}`;
  const itemDiffs = diffs[diffKey] || [];

  const renderGenerics = (params?: TypeDataParam[]) => {
    const genericsStyle = customColors?.genericsColor
      ? { color: customColors.genericsColor }
      : {};
    const keywordStyle = customColors?.typeKeyword
      ? { color: customColors.typeKeyword }
      : {};

    if (!params || params.length === 0) return null;
    return (
      <span className="text-muted-foreground pr-1">
        {"<"}
        {params.map((p, i) => (
          <span key={i}>
            {i > 0 && ", "}
            <span
              style={genericsStyle}
              className={cn(!customColors?.genericsColor && "text-yellow-200")}
            >
              {p.name}
            </span>
            {p.constraint && (
              <>
                <span
                  style={keywordStyle}
                  className={cn(
                    !customColors?.typeKeyword && "text-purple-400",
                  )}
                >
                  {" "}
                  extends{" "}
                </span>
                <TypeRenderer type={p.constraint} typeData={typeData} />
              </>
            )}
            {p.default && (
              <>
                <span
                  style={keywordStyle}
                  className={cn(
                    !customColors?.typeKeyword && "text-purple-400",
                  )}
                >
                  {" "}
                  ={" "}
                </span>
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
            <span className="text-primary">{getDisplayName(item.name)}</span>
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

          {item.declarationKind && (
            <div className="flex gap-2 text-xs">
              <span className="font-semibold text-muted-foreground/80 min-w-12">
                Kind:
              </span>
              <span className="text-muted-foreground">
                {item.declarationKind}
              </span>
            </div>
          )}

          {item.tag && (
            <div className="flex gap-2 text-xs">
              <span className="font-semibold text-muted-foreground/80 min-w-12">
                Tag:
              </span>
              <span className="text-muted-foreground">{item.tag}</span>
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
                <span
                  style={
                    customColors?.typeKeyword
                      ? { color: customColors.typeKeyword }
                      : {}
                  }
                  className={cn(
                    !customColors?.typeKeyword && "text-purple-400",
                  )}
                >
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
                    className={cn(
                      "flex justify-between py-0.5 border-b border-border/50 last:border-0",
                      p.gitStatus === "deleted" &&
                        "opacity-50 line-through bg-destructive/10",
                      p.gitStatus === "added" && "bg-green-500/10",
                      p.gitStatus === "modified" && "bg-amber-500/10",
                    )}
                  >
                    <span
                      className={cn(
                        "text-primary",
                        p.gitStatus === "deleted" && "text-destructive",
                        p.gitStatus === "added" && "text-green-500",
                        p.gitStatus === "modified" && "text-amber-500",
                      )}
                    >
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
              {renderNodes.map((v) => {
                const renders = item.renders;

                const renderId = v.id.slice((selectedId! + "-render-").length);

                const render = renders?.[renderId];

                if (!render) return null;

                return (
                  <div
                    key={v.id}
                    className="text-xs font-mono bg-muted/30 p-2 rounded border border-border/50"
                  >
                    <div className="font-bold text-primary mb-1">
                      {getDisplayName(v.name)}
                    </div>

                    <div className="space-y-1">
                      {render.dependencies.map(
                        (dep: ComponentInfoRenderDependency, i: number) => (
                          <div key={i} className="flex gap-2">
                            <span
                              style={
                                customColors?.genericsColor
                                  ? {
                                      color: customColors.genericsColor,
                                      opacity: 0.8,
                                    }
                                  : {}
                              }
                              className={cn(
                                !customColors?.genericsColor &&
                                  "text-yellow-200/80",
                              )}
                            >
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

        {item.hooks && item.hooks.length > 0 && (
          <div className="mt-4 pt-4 border-t border-border">
            <div className="flex items-center gap-2 mb-2">
              <span className="font-semibold text-muted-foreground">Hooks</span>
            </div>
            <div className="space-y-1">
              {item.hooks.map((hookId) => {
                const hookItem = graph.getPointByID(hookId);
                return (
                  <div
                    key={hookId}
                    className="flex items-center justify-between text-xs font-mono bg-muted/30 p-2 rounded border border-border/50 cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => onSelect?.(hookId)}
                  >
                    <span className="text-primary">
                      {hookItem ? getDisplayName(hookItem.name) : hookId}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {item.gitStatus && (
          <div className="mt-4 pt-4 border-t border-border">
            <div className="flex items-center gap-2 mb-2">
              <GitBranch className="h-4 w-4 text-amber-500" />
              <span className="font-semibold text-muted-foreground">
                Git Changes ({item.gitStatus})
              </span>
            </div>
            <GitDiffView
              diffs={itemDiffs}
              fileName={item.pureFileName || ""}
              scope={item.scope}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
