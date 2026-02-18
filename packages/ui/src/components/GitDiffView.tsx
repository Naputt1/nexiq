import type { GitFileDiff } from "shared";
import { cn } from "@/lib/utils";
import { useConfigStore } from "@/hooks/use-config-store";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";

interface GitDiffViewProps {
  diffs: GitFileDiff[];
  fileName: string;
  scope?: { start: { line: number }; end: { line: number } };
}

export function GitDiffView({ diffs, fileName, scope }: GitDiffViewProps) {
  const { customColors } = useConfigStore();
  const fileDiff = diffs.find((d) => d.path === fileName);
  if (!fileDiff)
    return (
      <Empty className="border-dashed py-4 min-h-32">
        <EmptyHeader>
          <EmptyTitle className="text-sm">No Git Changes</EmptyTitle>
          <EmptyDescription className="text-xs">
            No changes were found in this file's diff.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );

  const relevantHunks = fileDiff.hunks.filter((hunk) => {
    if (!scope) return true;
    const hunkEnd = hunk.newStart + hunk.newLines;
    return hunk.newStart <= scope.end.line && hunkEnd >= scope.start.line;
  });

  if (relevantHunks.length === 0) {
    return (
      <Empty className="border-dashed py-4 min-h-32">
        <EmptyHeader>
          <EmptyTitle className="text-sm">Outside Scope</EmptyTitle>
          <EmptyDescription className="text-xs">
            Changes in this file are outside this component's scope.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="space-y-4">
      {relevantHunks.map((hunk, i) => (
        <div key={i} className="border border-border rounded overflow-hidden">
          <div className="bg-muted px-2 py-1 text-[10px] text-muted-foreground font-mono border-b border-border">
            {hunk.content}
          </div>
          <div className="font-mono text-[11px] leading-tight">
            {hunk.lines.map((line, j) => {
              // Filter lines to show some context but focus on scope

              const lineStyle = {
                backgroundColor:
                  line.type === "added"
                    ? (customColors?.gitAdded || "#22c55e") + "1a" // 10% opacity
                    : line.type === "deleted"
                      ? (customColors?.gitDeleted || "#ef4444") + "1a"
                      : undefined,
                color:
                  line.type === "added"
                    ? customColors?.gitAdded || "#22c55e"
                    : line.type === "deleted"
                      ? customColors?.gitDeleted || "#ef4444"
                      : undefined,
              };

              return (
                <div
                  key={j}
                  className={cn(
                    "flex gap-2 px-2 whitespace-pre-wrap",
                    line.type === "added" && !customColors?.gitAdded && "bg-green-500/10 text-green-400",
                    line.type === "deleted" && !customColors?.gitDeleted && "bg-red-500/10 text-red-400",
                    line.type === "normal" && "text-muted-foreground",
                  )}
                  style={lineStyle}
                >
                  <span className="w-8 shrink-0 text-right opacity-50 select-none">
                    {line.newLineNumber || line.oldLineNumber}
                  </span>
                  <span className="shrink-0 opacity-50 select-none">
                    {line.type === "added"
                      ? "+"
                      : line.type === "deleted"
                        ? "-"
                        : " "}
                  </span>
                  <span>{line.content}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
