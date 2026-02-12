import { create } from "zustand";
import type { GitStatus, GitCommit, GitFileDiff, JsonData } from "shared";

interface GitState {
  status: GitStatus | null;
  history: GitCommit[];
  diffs: Record<string, GitFileDiff[]>;
  analyzedDiffs: Record<string, JsonData>;
  isLoading: boolean;
  error: string | null;

  // Actions
  refreshStatus: (projectRoot: string) => Promise<void>;
  loadHistory: (
    projectRoot: string,
    options?: number | { limit?: number; path?: string },
  ) => Promise<void>;
  stageFiles: (projectRoot: string, files: string[]) => Promise<void>;
  unstageFiles: (projectRoot: string, files: string[]) => Promise<void>;
  loadDiff: (
    projectRoot: string,
    options: { file?: string; commit?: string; staged?: boolean },
  ) => Promise<void>;
  loadAnalyzedDiff: (
    projectRoot: string,
    commitHash: string | null,
    subPath?: string,
  ) => Promise<JsonData | undefined>;
  clearAnalyzedDiffCache: () => void;
}

export const useGitStore = create<GitState>((set, get) => ({
  status: null,
  history: [],
  diffs: {},
  analyzedDiffs: {},
  isLoading: false,
  error: null,

  refreshStatus: async (projectRoot: string) => {
    set({ isLoading: true });
    try {
      const status = await window.ipcRenderer.invoke("git-status", projectRoot);
      // Clear "current" entries from analyzedDiffs cache when status is refreshed
      set((state) => {
        const newAnalyzedDiffs = { ...state.analyzedDiffs };
        Object.keys(newAnalyzedDiffs).forEach((key) => {
          if (key.startsWith("current")) {
            delete newAnalyzedDiffs[key];
          }
        });
        return { status, analyzedDiffs: newAnalyzedDiffs, error: null };
      });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      set({ isLoading: false });
    }
  },

  loadHistory: async (
    projectRoot: string,
    options?: number | { limit?: number; path?: string },
  ) => {
    set({ isLoading: true });
    try {
      const history = await window.ipcRenderer.invoke(
        "git-log",
        projectRoot,
        options,
      );
      set({ history, error: null });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      set({ isLoading: false });
    }
  },

  stageFiles: async (projectRoot: string, files: string[]) => {
    try {
      await window.ipcRenderer.invoke("git-stage", projectRoot, files);
      await get().refreshStatus(projectRoot);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  unstageFiles: async (projectRoot: string, files: string[]) => {
    try {
      await window.ipcRenderer.invoke("git-unstage", projectRoot, files);
      await get().refreshStatus(projectRoot);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  loadDiff: async (
    projectRoot: string,
    options: { file?: string; commit?: string; staged?: boolean },
  ) => {
    const key = `${options.commit || "current"}-${options.staged ? "staged" : "working"}-${options.file || "all"}`;
    try {
      const diff = await window.ipcRenderer.invoke(
        "git-diff",
        projectRoot,
        options,
      );
      set((state) => ({
        diffs: { ...state.diffs, [key]: diff },
      }));
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  loadAnalyzedDiff: async (
    projectRoot: string,
    commitHash: string | null,
    subPath?: string,
  ) => {
    const key = subPath
      ? `${commitHash || "current"}-${subPath}`
      : commitHash || "current";
    const cached = get().analyzedDiffs[key];
    if (cached) return cached;

    set({ isLoading: true });
    try {
      let dataB: JsonData;
      let dataA: JsonData;

      if (commitHash) {
        // 1. Analyze target commit
        dataB = await window.ipcRenderer.invoke(
          "git-analyze-commit",
          projectRoot,
          commitHash,
          subPath,
        );

        // 2. Analyze parent commit (handle root commit)
        try {
          const parentHash = `${commitHash}^`;
          dataA = await window.ipcRenderer.invoke(
            "git-analyze-commit",
            projectRoot,
            parentHash,
            subPath,
          );
        } catch {
          // Root commit, use empty graph as parent
          dataA = { files: {}, edges: [], src: "" };
        }
      } else {
        // 1. Current state
        dataB = (await window.ipcRenderer.invoke(
          "read-graph-data",
          projectRoot,
          subPath ? `${projectRoot}/${subPath}` : undefined,
        ))!;

        // 2. HEAD commit
        dataA = await window.ipcRenderer.invoke(
          "git-analyze-commit",
          projectRoot,
          "HEAD",
          subPath,
        );
      }

      // 3. Compare them
      const diffResult = await window.ipcRenderer.invoke(
        "analyze-diff",
        dataA,
        dataB,
      );
      
      set((state) => ({
        analyzedDiffs: { ...state.analyzedDiffs, [key]: diffResult },
      }));
      return diffResult;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      set({ isLoading: false });
    }
  },

  clearAnalyzedDiffCache: () => set({ analyzedDiffs: {} }),
}));

