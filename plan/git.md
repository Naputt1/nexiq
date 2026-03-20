# Git Interface Implementation Plan

This plan outlines the integration of Git functionality. The backend logic (Git data analysis, commit history, diff parsing) is implemented in `packages/server` within this repository. The corresponding UI components (Sidebar, History Panel, Visualizations) have been moved to the external `nexiq-ui` repository.

## Phase 1: Infrastructure & Backend (Done - `packages/server`)

- [x] **Git Data Types**: Define shared types for Git status, commits, and diffs.
- [x] **Backend Integration**: Add `simple-git` to the server process (`ProjectManager`).
- [x] **IPC/MCP Handlers**: Implement handlers for:
  - `git-status`: Current working tree state.
  - `git-log`: Commit history.
  - `git-stage`/`git-unstage`: File staging management.
  - `git-diff`: Fetching raw diffs and parsing them into structured hunks/lines.

## Phase 2: UI State & Sidebar (Moved to `nexiq-ui`)

- [x] **Git Store**: Create a Zustand store to manage Git state, history selection, and diff caching.
- [x] **Git Panel Component**:
  - Display staged and unstaged files.
  - Add buttons to stage/unstage files.
  - Display a scrollable list of recent commits.
- [x] **Sidebar Integration**: Add a tabbed interface to the main sidebar to switch between "Project Explorer" and "Git Control".

## Phase 3: Graph Visualization (Moved to `nexiq-ui`)

- [x] **Historical Snapshot Rendering**:
  - [x] Refactored `loadData` to render the graph structure of the selected commit instead of the current working tree.
  - [x] Implemented `git archive` based analysis in the backend to generate clean historical snapshots.
- [x] **Local Context Highlighting**:
  - [x] Updated `loadAnalyzedDiff` to compare the selected commit (`dataB`) against its immediate parent (`dataA`, using `commitHash^`).
  - [x] This ensures "Modified" and "Added" indicators reflect changes introduced *within* that specific commit.
- [x] **Visual Cues**:
  - [x] Update node/combo styles in the renderer to show modified/added/deleted states (amber/green/red indicators).
  - [x] Components that did not exist yet in the historical snapshot are automatically omitted from the graph.

## Phase 4: Polish & Interaction (Moved to `nexiq-ui`)

- [x] **History UX**:
  - [x] Add "Current Working Tree" to the top of the history list for easier switching.
  - [x] Update "Changes" section to show files from the selected historical commit.
- [x] **Monorepo Historical Support**:
  - [x] Implemented `subPath` scoping for historical analysis to support monorepo sub-projects in past commits.
- [ ] **Position Persistence**: Borrow positions from the current working tree for historical nodes with matching IDs to maintain visual continuity.
- [ ] **Auto-refresh**: Trigger Git status updates on file system changes.

---

## Current Progress Summary

- **Backend**: `git-analyze-commit` supports `subPath` and uses `git archive` for clean historical analysis.
- **UI Architecture**: Implemented in external `nexiq-ui` repo.
- **Core Logic**: `ComponentGraph` renders the "True Past" graph structure.
- **Next Step**: Backend support for position borrowing (if needed) or purely UI implementation.

---

## Testing the Git Feature

To easily test and identify Git changes, follow these steps:

1.  **Run the Demo Setup Script**:

    ```bash
    bash scripts/setup-git-demo.sh
    ```

    This creates a dummy React project in `packages/sample-project/git-demo` with historical commits and pending modifications.

2.  **Open the Demo Project**:
    - Start `nexiq` (server) and the external UI.
    - Click "Select Directory" and choose `packages/sample-project/git-demo`.

3.  **Explore Git Control**:
    - Use the external UI to test Git features.
