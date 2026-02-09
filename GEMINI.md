# react-map

`react-map` is a tool designed to analyze React component structures and visualize their dependencies. It parses source code to extract component definitions, imports, exports, and props, generating a graph representation that can be explored in a desktop application.

## Project Structure

This is a monorepo managed by `pnpm`, consisting of the following packages:

- **`packages/analyser`**: The core logic for source code analysis.
  - Uses `@babel/parser` and `@babel/traverse` to parse TypeScript/React files.
  - Extracts component relationships, props (including destructuring and types), and hooks.
  - Generates a JSON graph output.
  - Supports caching for incremental analysis.
- **`packages/ui`**: An Electron-based desktop application for visualizing the component graph.
  - Built with React, Vite, and Tailwind CSS.
  - Uses `@antv/g6`, `Konva`, and `react-konva` for graph rendering and interactions.
  - Integrates with the `analyser` package to display project data.
- **`packages/shared`**: Common TypeScript types and utilities shared between the analyser and the UI.
- **`packages/sample-project`**: A collection of sample React projects (`simple`, `complex`, `props`, `hook`, etc.) used for testing and snapshot verification.

## Core Technologies

- **Language**: TypeScript
- **Package Manager**: `pnpm`
- **Source Analysis**: Babel (`@babel/parser`, `@babel/traverse`)
- **Frontend**: React, React Router, Radix UI
- **Styling**: Tailwind CSS
- **Visualization**: Konva / React-Konva, AntV G6
- **Desktop Environment**: Electron
- **Build Tools**: Vite (using `rolldown-vite` via overrides), `tsup`
- **Testing**: Vitest

## Getting Started

### Prerequisites

- `pnpm` installed.
- Node.js (version compatible with the project, likely 20+).

### Building and Running

From the project root:

- **Install Dependencies**:
  ```bash
  pnpm install
  ```

- **Run UI in Development Mode**:
  ```bash
  pnpm dev:ui
  ```
  This starts the Vite dev server for the Electron app.

- **Run Analyser on Samples**:
  ```bash
  pnpm --filter=analyser dev
  ```
  This builds the analyser in watch mode and runs it against the `sample-project`.

- **Run Tests**:
  ```bash
  pnpm test:analyze
  ```

- **Update Snapshots**:
  ```bash
  pnpm snapshot:analyze
  ```
  This runs the analyser against all sample projects and updates the JSON snapshots in `packages/analyser/test/snapshots/`.

## Development Conventions

### Monorepo Management

- Use `pnpm` for all dependency management.
- Shared code should reside in `packages/shared`.
- Use workspace-relative imports (e.g., `"shared": "workspace:*"`).

### Feature Tracking

- **Requirement**: When adding or editing a feature, you MUST read, edit, or write to `plan/{feature}.md` to track current progress and next steps.
- **Example**: For the Git feature, refer to `plan/git.md`.

### Analyser Development

- The analyser logic is located in `packages/analyser/src/analyzer/`.
- New features should be verified with tests in `packages/analyser/src/analyzer.test.ts`.
- If changing the graph structure, run `pnpm snapshot:analyze` to update baseline snapshots.

### UI Development

- Components are located in `packages/ui/src/components/`.
- Global state is managed using `zustand`.
- Graph visualization logic is primarily in `packages/ui/src/graph/` and `packages/ui/src/componentGraph.tsx`.

### Code Style

- ESLint is configured for both `analyser` and `ui` packages.
- Follow existing patterns for Babel traversal and React component structure.

### TypeScript & Typing

- **No `any`**: The use of the `any` type is strictly forbidden.
- **Explicit Types**: Always create explicit types or interfaces for data structures, function parameters, and IPC messages. Use generics where appropriate to maintain type safety across boundaries (e.g., Electron IPC).
