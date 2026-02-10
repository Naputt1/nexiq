import { useEffect, useState } from "react";
import { useGitStore } from "@/hooks/useGitStore";
import { Button } from "./ui/button";
import {
  GitBranch,
  History,
  Plus,
  Minus,
  FileCode,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Separator } from "./ui/separator";

interface GitPanelProps {
  projectRoot: string;
  onLocateFile?: (filePath: string) => void;
}

export function GitPanel({ projectRoot, onLocateFile }: GitPanelProps) {
  const {
    status,
    history,
    selectedCommit,
    diffs,
    isLoading,
    refreshStatus,
    loadHistory,
    setSelectedCommit,
    stageFiles,
    unstageFiles,
    loadDiff,
  } = useGitStore();

  const [historyLimit, setHistoryLimit] = useState(50);
  const [expandedSections, setExpandedSections] = useState({
    staged: true,
    unstaged: true,
    history: true,
  });

  useEffect(() => {
    refreshStatus(projectRoot);
    loadHistory(projectRoot, historyLimit);
  }, [projectRoot, refreshStatus, loadHistory, historyLimit]);

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const handleRefresh = () => {
    refreshStatus(projectRoot);
    loadHistory(projectRoot, historyLimit);
  };

  const handleLoadMore = () => {
    setHistoryLimit((prev) => prev + 50);
  };

  const getActiveFiles = () => {
    if (!selectedCommit) {
      return status?.files.filter((f) => f.working_dir !== " ") || [];
    }

    // For historical commits, get file list from the cached diffs
    const diffKey = `${selectedCommit}-working-all`;
    const historicalDiffs = diffs[diffKey] || [];
    return historicalDiffs.map((d) => ({
      path: d.path,
      working_dir: "M", // Mock as modified for display
    }));
  };

  const activeFiles = getActiveFiles();

  return (
    <div className="flex flex-col h-full bg-background border-r border-border text-start">
      <div className="p-4 flex items-center justify-between border-b border-border">
        <div className="flex items-center gap-2 text-start">
          <GitBranch className="h-4 w-4" />
          <h2 className="text-sm font-semibold">Git Control</h2>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleRefresh}
          disabled={isLoading}
        >
          <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
        </Button>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="p-2 space-y-4">
          {/* Staged Changes (Only show when in working tree) */}
          {!selectedCommit && (
            <div>
              <div
                className="flex items-center justify-between px-2 py-1 cursor-pointer hover:bg-accent rounded"
                onClick={() => toggleSection("staged")}
              >
                <div className="flex items-center gap-2">
                  {expandedSections.staged ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                  <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Staged ({status?.staged.length || 0})
                  </span>
                </div>
              </div>

              {expandedSections.staged && (
                <div className="mt-1 space-y-1">
                  {status?.staged.map((file) => (
                    <div
                      key={file}
                      className="flex items-center justify-between px-4 py-1 group hover:bg-accent rounded text-xs"
                    >
                      <div className="flex items-center gap-2 overflow-hidden">
                        <FileCode className="h-3 w-3 shrink-0 text-blue-500" />
                        <span className="truncate" title={file}>
                          {file.split("/").pop()}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {onLocateFile && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => onLocateFile(file)}
                            title="Locate in Graph"
                          >
                            <Search className="h-3 w-3" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => unstageFiles(projectRoot, [file])}
                          title="Unstage"
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Changes (Dynamic based on selection) */}
          <div>
            <div
              className="flex items-center justify-between px-2 py-1 cursor-pointer hover:bg-accent rounded"
              onClick={() => toggleSection("unstaged")}
            >
              <div className="flex items-center gap-2">
                {expandedSections.unstaged ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  {selectedCommit ? "Files in Commit" : "Changes"} (
                  {activeFiles.length})
                </span>
              </div>
            </div>

            {expandedSections.unstaged && (
              <div className="mt-1 space-y-1">
                {activeFiles.map((f) => (
                  <div
                    key={f.path}
                    className="flex items-center justify-between px-4 py-1 group hover:bg-accent rounded text-xs"
                  >
                    <div className="flex items-center gap-2 overflow-hidden">
                      <FileCode className="h-3 w-3 shrink-0 text-amber-500" />
                      <span className="truncate" title={f.path}>
                        {f.path.split("/").pop()}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {onLocateFile && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => onLocateFile(f.path)}
                          title="Locate in Graph"
                        >
                          <Search className="h-3 w-3" />
                        </Button>
                      )}
                      {!selectedCommit && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => stageFiles(projectRoot, [f.path])}
                          title="Stage"
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Separator className="my-2" />

          {/* History */}
          <div>
            <div
              className="flex items-center justify-between px-2 py-1 cursor-pointer hover:bg-accent rounded"
              onClick={() => toggleSection("history")}
            >
              <div className="flex items-center gap-2">
                {expandedSections.history ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                <div className="flex items-center gap-1">
                  <History className="h-3 w-3" />
                  <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Timeline
                  </span>
                </div>
              </div>
            </div>

            {expandedSections.history && (
              <div className="mt-1 space-y-1">
                {/* Current Working Tree at the top */}
                <div
                  className={cn(
                    "px-4 py-2 cursor-pointer hover:bg-accent rounded flex flex-col gap-1 border-l-2",
                    selectedCommit === null
                      ? "border-primary bg-accent/50"
                      : "border-transparent",
                  )}
                  onClick={() => setSelectedCommit(null)}
                >
                  <span className="text-xs font-bold">Current Changes</span>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono">
                    <span>WORKING TREE</span>
                  </div>
                </div>

                <Separator className="my-1 mx-2" />

                {history.map((commit) => (
                  <div
                    key={commit.hash}
                    className={cn(
                      "px-4 py-2 cursor-pointer hover:bg-accent rounded flex flex-col gap-1 border-l-2",
                      selectedCommit === commit.hash
                        ? "border-primary bg-accent/50"
                        : "border-transparent",
                    )}
                    onClick={() => {
                      setSelectedCommit(commit.hash);
                      // Trigger diff load so we get the file list for the "Files in Commit" section
                      loadDiff(projectRoot, { commit: commit.hash });
                    }}
                  >
                    <span className="text-xs font-medium line-clamp-1">
                      {commit.message}
                    </span>
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>{commit.author_name}</span>
                      <span>{commit.hash.substring(0, 7)}</span>
                    </div>
                  </div>
                ))}
                {history.length >= historyLimit && (
                  <Button
                    variant="ghost"
                    className="w-full text-[10px] py-1 h-auto mt-2"
                    onClick={handleLoadMore}
                    disabled={isLoading}
                  >
                    Load More...
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
