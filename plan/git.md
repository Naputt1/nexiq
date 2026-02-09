# Git Interface Implementation Plan

This plan outlines the integration of Git functionality into the `react-map` UI, allowing users to visualize changes across different commits and the current working tree.

## Phase 1: Infrastructure & Backend (Done)

- [x] **Git Data Types**: Define shared types for Git status, commits, and diffs.
- [x] **Backend Integration**: Add `simple-git` to the Electron main process.
- [x] **IPC Handlers**: Implement handlers for:
  - `git-status`: Current working tree state.
  - `git-log`: Commit history.
  - `git-stage`/`git-unstage`: File staging management.
  - `git-diff`: Fetching raw diffs and parsing them into structured hunks/lines.

## Phase 2: UI State & Sidebar (Done)

- [x] **Git Store**: Create a Zustand store to manage Git state, history selection, and diff caching.
- [x] **Git Panel Component**:
  - Display staged and unstaged files.
  - Add buttons to stage/unstage files.
  - Display a scrollable list of recent commits.
- [x] **Sidebar Integration**: Add a tabbed interface to the main sidebar to switch between "Project Explorer" and "Git Control".

## Phase 3: Graph Visualization (Done)

- [x] **Component Mapping**: Map diff line numbers to component scopes defined by the analyzer.
- [x] **Highlighting Logic**: Implement `highlightGitChanges` in `ComponentGraph` to visually mark "dirty" components.
- [x] **Visual Cues**:
  - [x] Update node/combo styles in the renderer to show modified/added/deleted states (amber/green/red indicators).
  - [x] Add a "Diff View" in Node Details to show specific line changes when a dirty component is selected.

## Phase 4: Polish & Interaction (In Progress)

- [x] **History UX**:
  - [x] Add "Current Working Tree" to the top of the history list for easier switching.
  - [x] Update "Changes" section to show files from the selected historical commit.
- [x] **Visual Differentiation**:
  - [x] Use different colors for "Added" (green) vs "Modified" (amber) in the graph.
- [x] **Advanced Historical Mapping**:
  - [x] **Line Shift Resilience**: Use `git diff <commit> HEAD` to calculate line offsets between historical diffs and the current graph.
  - [x] **Future Components**: Identify and hide components that did not exist yet in the selected historical commit (by checking if their current range is entirely "added" in `git diff <commit> HEAD`).
- [ ] **Auto-refresh**: Trigger Git status updates on file system changes.
- [ ] **Performance**: Optimize diff parsing for large projects.

---

## Current Progress Summary

- **Backend**: Fully implemented. `git-diff` updated to use `git show` for historical diffs.
- **UI Architecture**: Refactored `GitPanel` to unify history and dynamic file lists.
- **Core Logic**: `ComponentGraph` identifies "dirty" components, but historical mapping is currently sensitive to line shifts.
- **Visualization**: Unchanged components are muted.
- **Next Step**: Implement the "Future Component" detection logic to hide components that weren't born yet when viewing old commits.

---

## Testing the Git Feature

To easily test and identify Git changes, follow these steps:

1.  **Run the Demo Setup Script**:

    ```bash
    bash scripts/setup-git-demo.sh
    ```

    This creates a dummy React project in `packages/sample-project/git-demo` with historical commits and pending modifications.

2.  **Open the Demo Project**:
    - Start `react-map`.
    - Click "Select Directory" and choose `packages/sample-project/git-demo`.

3.  **Explore Git Control**:
    - Switch to the **Git Branch icon** tab in the sidebar.
    - Click on different commits in the **History** section.
    - Observe the graph: unchanged components will be muted (low opacity), while modified ones will have an amber indicator.
    - Click the **Search/Locate icon** next to `src/App.tsx` in the "Changes" section to instantly center the graph on the modified component.

4.  **View Diffs**:
    - Select a modified component (with the amber dot).
    - In the **Node Details** panel, scroll to the bottom to see the specific code changes (added/deleted lines) for that component.
