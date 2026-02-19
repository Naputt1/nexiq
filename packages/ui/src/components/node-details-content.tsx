import { X, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
} from "@/components/ui/empty";

import { type TypeDataDeclare, getDisplayName } from "shared";
import type { GraphComboData, GraphNodeData, GraphData } from "@/graph/hook";
import { useMemo } from "react";
import { getDetailSections } from "@/registry/detail-sections";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

interface NodeDetailsContentProps {
  selectedId: string | null;
  item: GraphNodeData | GraphComboData | undefined;
  renderNodes: GraphNodeData[];
  typeData: Record<string, TypeDataDeclare>;
  projectPath: string;
  onClose?: () => void;
  onSelect?: (id: string) => void;
  graph: GraphData;
  hideHeader?: boolean;
}

export function NodeDetailsContent({
  selectedId,
  item,
  renderNodes,
  typeData,
  projectPath,
  onClose,
  onSelect,
  graph,
  hideHeader = false,
}: NodeDetailsContentProps) {
  const allSections = useMemo(() => getDetailSections(), []);

  if (!selectedId || !item) {
    return (
      <Empty className="h-full border-none">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Info className="h-4 w-4" />
          </EmptyMedia>
          <EmptyTitle>No Selection</EmptyTitle>
          <EmptyDescription>
            Select a node in the graph to view its details.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const visibleSections = allSections.filter((section) =>
    section.shouldShow(item),
  );
  const defaultExpanded = visibleSections
    .filter((s) => s.defaultOpen)
    .map((s) => s.id);

  const type =
    item.type ||
    (Object.prototype.hasOwnProperty.call(item, "collapsedRadius")
      ? "Combo"
      : "Node");

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {!hideHeader && (
        <div className="flex flex-row justify-between items-start p-4 pb-2 shrink-0 border-b border-border">
          <div className="flex flex-col gap-1 overflow-hidden text-start">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
              {item.type || type}
            </span>
            <div className="text-lg font-bold flex items-center gap-1 truncate">
              <span className="text-primary">
                {item.displayName || getDisplayName(item.name)}
              </span>
            </div>
          </div>
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
            >
              <X className="h-5 w-5" />
            </Button>
          )}
        </div>
      )}
      <div className="overflow-y-auto overscroll-contain flex-1 px-4 select-text">
        <Accordion
          type="multiple"
          defaultValue={defaultExpanded}
          className="w-full"
        >
          {visibleSections.map((section) => {
            const Component = section.component;
            return (
              <AccordionItem
                key={section.id}
                value={section.id}
                className="border-b border-border/50 last:border-0"
              >
                <AccordionTrigger className="hover:no-underline py-3">
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    {section.title}
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <Component
                    selectedId={selectedId}
                    item={item}
                    graph={graph}
                    projectPath={projectPath}
                    typeData={typeData}
                    onSelect={onSelect}
                    renderNodes={renderNodes}
                  />
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </div>
    </div>
  );
}
