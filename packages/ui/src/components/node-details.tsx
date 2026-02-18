import { Card, CardContent } from "@/components/ui/card";
import {
  type TypeDataDeclare,
} from "shared";
import type { GraphComboData, GraphNodeData, GraphData } from "@/graph/hook";
import { NodeDetailsContent } from "./node-details-content";

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

export function NodeDetails(props: NodeDetailsProps) {
  if (!props.selectedId || !props.item) return null;

  return (
    <Card className="absolute top-4 left-16 w-96 shadow-lg z-50 bg-popover border-border text-foreground overflow-hidden flex flex-col max-h-[90vh]">
      <CardContent className="p-0 overflow-hidden flex flex-col h-full">
        <NodeDetailsContent {...props} />
      </CardContent>
    </Card>
  );
}
