import type { VariableName } from "./component.js";
import type { GitFileDiff, GitDiffHunk } from "./types/git.js";

export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export const getDisplayName = (
  name: VariableName | string | undefined,
): string => {
  if (!name) return "unknown";
  if (typeof name === "string") return name;
  if (name.type === "identifier") return name.name;
  if (name.type === "rest") return `...${getDisplayName(name.argument)}`;
  return "raw" in name ? name.raw : "unknown";
};

export function parseRawDiff(
  rawDiff: string,
  filterFile?: string,
): GitFileDiff[] {
  const files: GitFileDiff[] = [];
  if (!rawDiff) return files;

  const fileDiffs = rawDiff.split(/^diff --git /m).slice(1);

  for (const fileDiff of fileDiffs) {
    const lines = fileDiff.split("\n");
    const header = lines[0];
    if (!header) continue;
    const pathMatch = header.match(/a\/(.*) b\/(.*)/);
    if (!pathMatch) continue;

    const filePath = pathMatch[2];
    if (filterFile && filePath !== filterFile) continue;

    const hunks: GitDiffHunk[] = [];
    let currentHunk: GitDiffHunk | null = null;

    let oldLineNum = 0;
    let newLineNum = 0;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]!;
      if (line.startsWith("@@")) {
        const hunkMatch = line.match(/@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
        if (hunkMatch) {
          oldLineNum = parseInt(hunkMatch[1]!);
          newLineNum = parseInt(hunkMatch[3]!);
          currentHunk = {
            content: line,
            lines: [],
            oldStart: oldLineNum,
            oldLines: parseInt(hunkMatch[2] || "1"),
            newStart: newLineNum,
            newLines: parseInt(hunkMatch[4] || "1"),
          };
          hunks.push(currentHunk);
        }
      } else if (currentHunk) {
        if (line.startsWith("+")) {
          currentHunk.lines.push({
            type: "added",
            content: line.substring(1),
            newLineNumber: newLineNum++,
          });
        } else if (line.startsWith("-")) {
          currentHunk.lines.push({
            type: "deleted",
            content: line.substring(1),
            oldLineNumber: oldLineNum++,
          });
        } else if (line.startsWith(" ")) {
          currentHunk.lines.push({
            type: "normal",
            content: line.substring(1),
            oldLineNumber: oldLineNum++,
            newLineNumber: newLineNum++,
          });
        }
      }
    }

    files.push({
      path: filePath!,
      hunks,
    });
  }

  return files;
}
