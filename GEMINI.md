# react-map

`react-map` is a tool designed to analyze React component structures and visualize their dependencies. It parses source code to extract component definitions, imports, exports, and props, generating a graph representation that can be explored via a **Model Context Protocol (MCP)** server or a desktop application.

The project has pivoted towards an **MCP-first architecture**, where the core analysis and project management logic resides in a shared backend that serves both LLMs (via MCP) and human developers (via Electron).

## Project Structure

This is a monorepo managed by `pnpm`, consisting of the following packages:

- **`packages/analyser`**: The core logic for source code analysis.
  - Uses `@babel/parser` and `@babel/traverse` to parse TypeScript/React files.
  - Extracts component relationships, props (including destructuring and types), and hooks.
  - Generates a JSON graph output.
  - Supports caching for incremental analysis.
- **`packages/server`**: The primary entry point for LLM-driven code exploration.
  - Implements an MCP server providing tools like `open_project`, `get_symbol_info`, and `list_files`.
  - Supports dynamic extension loading to register project-specific tools (e.g., TanStack Query/Router).
- **`packages/extension-sdk`**: SDK for creating extensions that add custom graph tasks, UI sections, or MCP tools.
- **`packages/shared`** (as `@react-map/shared`): Common TypeScript types and utilities shared across the monorepo.
- **`packages/sample-project`**: A collection of sample React projects used for testing and snapshot verification.

_Note: The UI application has been moved to a separate repository: `react-map-ui`._

## Core Technologies

- **Language**: TypeScript
- **Package Manager**: `pnpm`
- **Source Analysis**: Babel (`@babel/parser`, `@babel/traverse`)
- **Backend Communication**: Model Context Protocol (MCP), WebSockets (ws)
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

- **Run Analyser on Samples**:

  ```bash
  pnpm --filter=analyser dev
  ```

  This builds the analyser in watch mode and runs it against the `sample-project`.

- **Run Tests**:

  ```bash
  pnpm test:analyze
  ```

  _Note for AI Agent: Always use `pnpm test:analyze` (which runs `vitest run`) instead of `pnpm vitest` to ensure the process exits after completion and doesn't get stuck in watch mode._

- **Run Benchmarks**:

  ```bash
  pnpm benchmark
  ```

  This starts the interactive CLI tool for running benchmarks across different projects and models.

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
- New features should be verified with tests in `packages/analyser/src/analyzer.test.ts`. Use `pnpm test:analyze` to run tests once and exit.
- If changing the graph structure, run `pnpm snapshot:analyze` to update baseline snapshots.

### Code Style

- ESLint is configured for the project.
- Follow existing patterns for Babel traversal and React component structure.

### Testing & Coverage

- **100% Coverage**: ALL backend packages (`analyser`, `server`, `mcp`, `shared`) MUST maintain 100% test coverage.
- **Unit Tests**: Every new feature or tool handler must include corresponding unit tests in a `.test.ts` file.
- **Verification**: Always run `pnpm test` (or the package-specific test command) to ensure all tests pass and coverage is maintained before submitting changes.

### TypeScript & Typing

- **No `any`**: The use of the `any` type is strictly forbidden.
- **Explicit Types**: Always create explicit types or interfaces for data structures, function parameters, and IPC messages. Use generics where appropriate to maintain type safety across boundaries (e.g., Electron IPC).
