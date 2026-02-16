import { memo, useRef, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import { Separator } from "./ui/separator";
import type { GitCommit } from "shared";

interface HistoryItemProps {
  commit: GitCommit;
  isSelected: boolean;
  onClick: () => void;
  style: React.CSSProperties;
}

const HistoryItem = memo(
  ({ commit, isSelected, onClick, style }: HistoryItemProps) => {
    return (
      <div
        className={cn(
          "absolute top-0 left-0 w-full px-4 py-2 cursor-pointer hover:bg-accent rounded flex flex-col gap-1 border-l-2",
          isSelected ? "border-primary bg-accent/50" : "border-transparent",
        )}
        style={style}
        onClick={onClick}
      >
        <span className="text-xs font-medium line-clamp-1">
          {commit.message}
        </span>
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>{commit.author_name}</span>
          <span>{commit.hash.substring(0, 7)}</span>
        </div>
      </div>
    );
  },
);

interface GitHistoryListProps {
  history: GitCommit[];
  selectedCommit: string | null;
  onSelectCommit: (hash: string | null) => void;
  isLoading: boolean;
  onLoadMore: () => void;
  historyLimit: number;
}

export const GitHistoryList = memo(function GitHistoryList({
  history,
  selectedCommit,
  onSelectCommit,
  isLoading,
  onLoadMore,
  historyLimit,
}: GitHistoryListProps) {
  const historyParentRef = useRef<HTMLDivElement>(null);

  // eslint-disable-next-line react-hooks/incompatible-library
  const historyVirtualizer = useVirtualizer({
    count: history.length + 2, // Current Changes + Separator + History
    getScrollElement: () => historyParentRef.current,
    estimateSize: (index) => {
      if (index === 0) return 50;
      if (index === 1) return 12; // Compact separator
      return 50;
    },
    overscan: 10,
    getItemKey: (index) => {
      if (index === 0) return "current-changes";
      if (index === 1) return "separator";
      return history[index - 2]?.hash || `history-${index}`;
    },
  });

  const virtualItems = historyVirtualizer.getVirtualItems();
  const lastItemIndex =
    virtualItems.length > 0 ? virtualItems[virtualItems.length - 1].index : -1;

  useEffect(() => {
    if (lastItemIndex === -1) return;

    if (
      lastItemIndex >= history.length &&
      history.length >= historyLimit &&
      !isLoading
    ) {
      onLoadMore();
    }
  }, [lastItemIndex, history.length, historyLimit, isLoading, onLoadMore]);

  return (
    <div
      ref={historyParentRef}
      className="flex-1 overflow-auto p-2 pt-0 min-h-0"
    >
      <div
        style={{
          height: `${historyVirtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualItems.map((virtualItem) => {
          if (virtualItem.index === 0) {
            return (
              <div
                key={virtualItem.key}
                className={cn(
                  "absolute top-0 left-0 w-full px-4 py-2 cursor-pointer hover:bg-accent rounded flex flex-col gap-1 border-l-2",
                  selectedCommit === null
                    ? "border-primary bg-accent/50"
                    : "border-transparent",
                )}
                style={{
                  height: `${virtualItem.size}px`,
                  transform: `translateY(${virtualItem.start}px)`,
                }}
                onClick={() => onSelectCommit(null)}
              >
                <span className="text-xs font-bold">Current Changes</span>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono">
                  <span>WORKING TREE</span>
                </div>
              </div>
            );
          }

          if (virtualItem.index === 1) {
            return (
              <div
                key={virtualItem.key}
                className="absolute top-0 left-0 w-full px-2 flex items-center"
                style={{
                  height: `${virtualItem.size}px`,
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                <Separator />
              </div>
            );
          }

          const commit = history[virtualItem.index - 2];
          if (!commit) return null;

          return (
            <HistoryItem
              key={virtualItem.key}
              commit={commit}
              isSelected={selectedCommit === commit.hash}
              onClick={() => onSelectCommit(commit.hash)}
              style={{
                height: `${virtualItem.size}px`,
                transform: `translateY(${virtualItem.start}px)`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
});
