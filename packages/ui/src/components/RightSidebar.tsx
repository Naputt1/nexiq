import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { ChevronRight, ChevronDown, ListTree, Info, X } from "lucide-react";
import { getDisplayName, type TypeDataDeclare } from "shared";
import { NodeDetailsContent } from "./node-details-content";
import {
  GraphData,
  GraphNode,
  GraphCombo,
  type GraphNodeData,
} from "@/graph/hook";
import { cn } from "@/lib/utils";
import { useAppStateStore } from "@/hooks/use-app-state-store";
import { Button } from "./ui/button";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useDefaultLayout } from "react-resizable-panels";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
} from "./ui/empty";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "./ui/resizable";

interface FlatTreeNode {
  id: string;
  name: string;
  type: string;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  isHighlighted: boolean;
}

interface RightSidebarProps {
  selectedId: string;
  graph: GraphData;
  typeData: Record<string, TypeDataDeclare>;
  projectPath: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  renderNodes: GraphNodeData[];
}

export const RightSidebar = React.memo(function RightSidebar({
  selectedId,
  graph,
  typeData,
  projectPath,
  onSelect,
  onClose,
  renderNodes,
}: RightSidebarProps) {
  const detailsHeightRatio = useAppStateStore((s) => s.sidebar.right.height);
  const setDetailsHeightRatio = useAppStateStore(
    (s) => s.setRightSidebarHeight,
  );

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [forceUpdate, setForceUpdate] = useState(0);

  // Persistence bridge for useDefaultLayout
  const storage = useMemo(
    () => ({
      getItem: () => {
        return JSON.stringify({
          tree: 100 - detailsHeightRatio,
          details: detailsHeightRatio,
        });
      },
      setItem: (_: string, value: string) => {
        const layout = JSON.parse(value);
        console.log("layout", layout);
        if (layout.details !== undefined) {
          setDetailsHeightRatio(layout.details);
        }
      },
    }),
    [detailsHeightRatio, setDetailsHeightRatio],
  );

  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "right-sidebar-vertical",
    panelIds: ["tree", "details"],
    storage,
  });

  // Subscribe to graph changes to ensure we re-render when nodes move or are added
  useEffect(() => {
    const unbind = graph.bind(() => {
      setForceUpdate((v) => v + 1);
    });
    return () => graph.unbind(unbind);
  }, [graph]);

  // Initialize/Sync expanded state with path to selectedId
  useEffect(() => {
    const item = graph.getPointByID(selectedId);
    if (!item) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpandedIds((prev) => {
      const newExpanded = new Set(prev);
      let changed = false;
      let curr: GraphNode | GraphCombo | undefined = item;

      // We expand all parents to make selectedId visible
      while (curr && curr.parent) {
        if (!newExpanded.has(curr.parent.id)) {
          newExpanded.add(curr.parent.id);
          changed = true;
        }
        curr = curr.parent;
      }

      // Also expand the selectedId itself if it has children
      if (!newExpanded.has(selectedId)) {
        newExpanded.add(selectedId);
        changed = true;
      }

      return changed ? newExpanded : prev;
    });
    // We only want to auto-expand when selectedId changes
  }, [selectedId, graph]);

  const toggleExpand = useCallback((id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const flatTree = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    forceUpdate; // trigger re-render
    const item = graph.getPointByID(selectedId);
    if (!item) return [];

    // 1. Find the top-level parent
    let topParent: GraphNode | GraphCombo = item;
    while (topParent.parent) {
      topParent = topParent.parent;
    }

    const list: FlatTreeNode[] = [];

    const walk = (curr: GraphNode | GraphCombo, depth: number) => {
      const children =
        curr instanceof GraphCombo && curr.child
          ? [
              ...Object.values(curr.child.combos),
              ...Object.values(curr.child.nodes),
            ]
          : [];

      const isExpanded = expandedIds.has(curr.id);

      list.push({
        id: curr.id,
        name: getDisplayName(curr.name),
        type: curr.type || (curr instanceof GraphCombo ? "Combo" : "Node"),
        depth,
        hasChildren: children.length > 0,
        isExpanded,
        isHighlighted: curr.id === selectedId,
      });

      if (isExpanded && children.length > 0) {
        children.forEach((child) => walk(child, depth + 1));
      }
    };

    walk(topParent, 0);
    return list;
  }, [selectedId, graph, expandedIds, forceUpdate]);

  const selectedItem = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    forceUpdate; // trigger re-render
    return graph.getPointByID(selectedId);
  }, [selectedId, graph, forceUpdate]);

  return (
    <ResizablePanelGroup
      orientation="vertical"
      className="h-full bg-background z-40"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
    >
      {/* Top: Tree Section */}
      <ResizablePanel id="tree" minSize="10%" className="flex flex-col">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/30 shrink-0">
          <div className="flex items-center gap-2">
            <ListTree className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Hierarchy
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 min-h-0">
          {flatTree.length > 0 ? (
            <VirtualTree
              flatTree={flatTree}
              onSelect={onSelect}
              onToggle={toggleExpand}
            />
          ) : (
            <Empty className="h-full border-none">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ListTree className="h-4 w-4" />
                </EmptyMedia>
                <EmptyTitle>No Hierarchy</EmptyTitle>
                <EmptyDescription>
                  This item has no structural children to display.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>
      </ResizablePanel>

      <ResizableHandle withHandle />

      {/* Bottom: Details Section */}
      <ResizablePanel id="details" minSize="10%" className="flex flex-col">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/30 shrink-0">
          <div className="flex items-center gap-2">
            <Info className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Details
            </span>
          </div>
        </div>
        <MemoizedDetailsContent
          selectedId={selectedId}
          item={selectedItem}
          renderNodes={renderNodes}
          typeData={typeData}
          projectPath={projectPath}
          onSelect={onSelect}
          graph={graph}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
});

const MemoizedDetailsContent = React.memo(
  ({
    selectedId,
    item,
    renderNodes,
    typeData,
    projectPath,
    onSelect,
    graph,
  }: {
    selectedId: string;
    item: GraphNode | GraphCombo | undefined;
    renderNodes: GraphNodeData[];
    typeData: Record<string, TypeDataDeclare>;
    projectPath: string;
    onSelect: (id: string) => void;
    graph: GraphData;
  }) => (
    <div className="flex-1 overflow-auto overscroll-contain">
      <NodeDetailsContent
        selectedId={selectedId}
        item={item}
        renderNodes={renderNodes}
        typeData={typeData}
        projectPath={projectPath}
        onSelect={onSelect}
        graph={graph}
        hideHeader={false}
      />
    </div>
  ),
);

const VirtualTree = React.memo(
  ({
    flatTree,
    onSelect,
    onToggle,
  }: {
    flatTree: FlatTreeNode[];
    onSelect: (id: string) => void;
    onToggle: (id: string, e?: React.MouseEvent) => void;
  }) => {
    const parentRef = useRef<HTMLDivElement>(null);

    const rowVirtualizer = useVirtualizer({
      count: flatTree.length,
      getScrollElement: () => parentRef.current,
      estimateSize: () => 28,
      overscan: 10,
    });

    return (
      <div
        ref={parentRef}
        className="h-full overflow-auto overscroll-contain p-2 scrollbar-thin scrollbar-thumb-muted-foreground/20"
      >
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const node = flatTree[virtualRow.index];
            if (!node) return null;
            return (
              <div
                key={node.id}
                className="absolute top-0 left-0 w-full"
                style={{
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <div
                  className={cn(
                    "flex items-center gap-1 px-2 py-1 rounded-sm cursor-pointer hover:bg-accent/50 group transition-colors",
                    node.isHighlighted &&
                      "bg-accent text-accent-foreground font-semibold",
                  )}
                  style={{ paddingLeft: `${node.depth * 12 + 4}px` }}
                  onClick={() => onSelect(node.id)}
                >
                  <div
                    className="w-4 h-4 flex items-center justify-center shrink-0"
                    onClick={(e) => node.hasChildren && onToggle(node.id, e)}
                  >
                    {node.hasChildren ? (
                      node.isExpanded ? (
                        <ChevronDown className="h-3 w-3 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-3 w-3 text-muted-foreground" />
                      )
                    ) : null}
                  </div>
                  <span
                    className="text-xs truncate whitespace-nowrap"
                    title={`${node.type}: ${node.name}`}
                  >
                    <span className="text-[10px] text-muted-foreground font-mono mr-1">
                      [{node.type.substring(0, 1).toUpperCase()}]
                    </span>
                    {node.name}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  },
);
