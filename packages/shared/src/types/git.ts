
export interface GitFileStatus {
  path: string;
  index: string; // 'A', 'M', 'D', '?', etc.
  working_dir: string;
}

export interface GitStatus {
  current: string | null;
  tracking: string | null;
  detached: boolean;
  files: GitFileStatus[];
  staged: string[];
}

export interface GitCommit {
  hash: string;
  date: string;
  message: string;
  author_name: string;
  author_email: string;
}

export interface GitDiff {
  file: string;
  diff: string;
}

export interface GitDiffLine {
  type: 'added' | 'deleted' | 'normal';
  content: string;
  newLineNumber?: number;
  oldLineNumber?: number;
}

export interface GitFileDiff {
  path: string;
  hunks: GitDiffHunk[];
}

export interface GitDiffHunk {
  content: string;
  lines: GitDiffLine[];
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
}
