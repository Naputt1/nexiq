import { useEffect, useState, useMemo, Suspense, useCallback } from "react";
import { useGitStore } from "@/hooks/useGitStore";
import { useAppStateStore } from "@/hooks/use-app-state-store";
import { Button } from "./ui/button";
import {
  GitBranch,
  History,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import type { DatabaseData } from "shared";

import { GitChangeTree } from "./GitChangeTree";
import { GitHistoryList } from "./GitHistoryList";

interface GitPanelProps {
  projectRoot: string;
  onLocateFile?: (filePath: string) => void;
  onSelectNode?: (id: string) => void;
}

interface SubProject {
  name: string;
  path: string;
}

export function GitPanel({
  projectRoot,
  onLocateFile: _onLocateFile,
  onSelectNode,
}: GitPanelProps) {
  const history = useGitStore((s) => s.history);
  const isLoading = useGitStore((s) => s.isLoading);
  const status = useGitStore((s) => s.status);
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const loadHistory = useGitStore((s) => s.loadHistory);
  const loadAnalyzedDiff = useGitStore((s) => s.loadAnalyzedDiff);

  const selectedCommit = useAppStateStore((s) => s.selectedCommit);
  const setSelectedCommit = useAppStateStore((s) => s.setSelectedCommit);
  const selectedSubProject = useAppStateStore((s) => s.selectedSubProject);
  const setSelectedSubProject = useAppStateStore(
    (s) => s.setSelectedSubProject,
  );
  const [subProjects, setSubProjects] = useState<SubProject[]>([]);
  const [analyzedData, setAnalyzedData] = useState<DatabaseData | null>(null);

  const [historyLimit, setHistoryLimit] = useState(50);
  const [expandedSections, setExpandedSections] = useState({
    changes: true,
    history: true,
  });

  useEffect(() => {
    const fetchSubProjects = async () => {
      try {
        const status = await window.ipcRenderer.invoke(
          "check-project-status",
          projectRoot,
        );
        if (status.subProjects) {
          setSubProjects(status.subProjects);
        }
      } catch (e) {
        console.error("Failed to fetch subprojects", e);
      }
    };
    fetchSubProjects();
  }, [projectRoot]);

  const relativeFilterPath = useMemo(() => {
    if (!selectedSubProject || selectedSubProject === projectRoot)
      return undefined;
    // Ensure we have a relative path for git commands
    let rel = selectedSubProject;
    if (selectedSubProject.startsWith(projectRoot)) {
      rel = selectedSubProject.substring(projectRoot.length);
      if (rel.startsWith("/") || rel.startsWith("\\")) {
        rel = rel.substring(1);
      }
    }
    return rel || undefined;
  }, [selectedSubProject, projectRoot]);

  useEffect(() => {
    refreshStatus(projectRoot);
  }, [projectRoot, refreshStatus]);

  useEffect(() => {
    loadHistory(projectRoot, {
      limit: historyLimit,
      path: relativeFilterPath,
    });
  }, [projectRoot, loadHistory, historyLimit, relativeFilterPath]);

  useEffect(() => {
    const load = async () => {
      const data = await loadAnalyzedDiff(
        projectRoot,
        selectedCommit,
        relativeFilterPath,
      );
      if (data) {
        setAnalyzedData(data);
      }
    };
    load();
  }, [
    projectRoot,
    selectedCommit,
    relativeFilterPath,
    loadAnalyzedDiff,
    status,
  ]);

  const toggleSection = useCallback(
    (section: keyof typeof expandedSections) => {
      setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
    },
    [],
  );

  const handleRefresh = useCallback(() => {
    refreshStatus(projectRoot);
    loadHistory(projectRoot, {
      limit: historyLimit,
      path: relativeFilterPath,
    });
  }, [
    projectRoot,
    refreshStatus,
    loadHistory,
    historyLimit,
    relativeFilterPath,
  ]);

  const handleLoadMore = useCallback(() => {
    setHistoryLimit((prev) => prev + 50);
  }, []);

  const subProjectItems = useMemo(() => {
    return subProjects.map((p) => (
      <SelectItem key={p.path} value={p.path}>
        {p.name}
      </SelectItem>
    ));
  }, [subProjects]);

  return (
    <div className="flex flex-col h-full bg-background border-r border-border text-start">
      <div className="p-4 flex items-center justify-between border-b border-border shrink-0">
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

      <div className="px-4 py-2 border-b border-border bg-accent/20 shrink-0">
        <div className="flex items-center gap-2 mb-1">
          <Layers className="h-3 w-3 text-muted-foreground" />
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Scope
          </span>
        </div>
        <Select
          value={selectedSubProject || projectRoot}
          onValueChange={(val) =>
            setSelectedSubProject(val === projectRoot ? null : val)
          }
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="All Changes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={projectRoot}>Entire Project</SelectItem>
            {subProjectItems}
          </SelectContent>
        </Select>
      </div>

      {/* Structural Changes (Dynamic based on selection) */}
      <div className="flex-2 min-h-0 flex flex-col border-b border-border">
        <div
          className="flex items-center justify-between px-4 py-2 cursor-pointer hover:bg-accent shrink-0"
          onClick={() => toggleSection("changes")}
        >
          <div className="flex items-center gap-2">
            {expandedSections.changes ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              {selectedCommit ? "Structural Changes" : "Component Changes"}
            </span>
          </div>
        </div>

        {expandedSections.changes && (
          <div className="flex-1 overflow-auto p-2 pt-0 min-h-0 relative">
            {!analyzedData && isLoading ? (
              <div className="p-4 text-xs text-muted-foreground text-center animate-pulse">
                Analyzing structural changes...
              </div>
            ) : analyzedData ? (
              <>
                <Suspense
                  fallback={
                    <div className="p-4 text-xs text-muted-foreground text-center animate-pulse">
                      Loading tree...
                    </div>
                  }
                >
                  <GitChangeTree data={analyzedData} onLocate={onSelectNode} />
                </Suspense>
                {isLoading && (
                  <div className="absolute inset-0 bg-background/20 backdrop-blur-[1px] z-10 flex items-center justify-center">
                    <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                )}
              </>
            ) : (
              <div className="p-4 text-xs text-muted-foreground text-center">
                No changes detected.
              </div>
            )}
          </div>
        )}
      </div>

      {/* History / Timeline */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div
          className="flex items-center justify-between px-4 py-2 cursor-pointer hover:bg-accent shrink-0"
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
          <GitHistoryList
            history={history}
            selectedCommit={selectedCommit}
            onSelectCommit={setSelectedCommit}
            isLoading={isLoading}
            onLoadMore={handleLoadMore}
            historyLimit={historyLimit}
          />
        )}
      </div>
    </div>
  );
}
