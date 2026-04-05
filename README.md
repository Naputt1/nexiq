# nexiq

`nexiq` is the analysis and backend core for exploring React component relationships, project structure, and extension-powered graph workflows.

## Key Features

- Analyze React and TypeScript codebases into graph data that can be inspected or consumed by other tools.
- Run an MCP-compatible backend server for project-aware tooling and editor or agent integrations.
- Share common graph, data, and SQLite-backed utilities across packages with `@nexiq/shared`.
- Build custom extensions that add graph tasks, UI sections, and MCP tools.

## How The Packages Fit Together

- `@nexiq/analyser` parses projects and produces the component and dependency graph data.
- `@nexiq/cli` runs the backend server and project management layer, including MCP and WebSocket support.
- `@nexiq/shared` contains shared types, utilities, and database helpers used across the stack.
- `@nexiq/extension-sdk` provides the extension interface for adding custom tasks and tooling around nexiq.

This repository is the backend half of the larger nexiq workflow. The desktop app in the sibling `nexiq-ui` repository consumes the server and shared packages from this monorepo to render interactive graph views.

## Quick Start

### Requirements

- Node.js
- `pnpm` 10+

### Install

```bash
cd nexiq
pnpm install
```

### Common Commands

```bash
pnpm build:analyze
pnpm dev:server
pnpm test:analyze
pnpm typecheck
```

### Package-Level Entry Commands

Useful commands exposed by the main packages:

```bash
pnpm --filter=@nexiq/analyser build
pnpm --filter=@nexiq/analyser start
pnpm --filter=@nexiq/analyser snapshot
pnpm --filter=@nexiq/cli dev
pnpm --filter=@nexiq/cli start
```

## Main Scripts

- `pnpm dev:server` starts the backend server package in development mode.
- `pnpm build:analyze` builds the analyser package.
- `pnpm test:analyze` runs the analyser test suite.
- `pnpm snapshot:analyze` builds the analyser and generates snapshot output.
- `pnpm benchmark` runs the CLI benchmark package.
- `pnpm benchmark:view` starts the benchmark viewer.
- `pnpm typecheck` runs type-checking across the workspace.
- `pnpm lint` runs linting across the workspace with autofix enabled.

## Extensions

`nexiq` is designed to be extended.

- Extensions are created as packages that depend on `@nexiq/extension-sdk` and `@nexiq/shared`.
- An extension can contribute MCP tools, graph tasks, and custom view logic.
- Projects can register extensions through `nexiq.config.json`.

Minimal example:

```ts
import type { Extension } from "@nexiq/extension-sdk";

const myExtension: Extension = {
  id: "my-custom-extension",
  mcpTools: [],
  viewTasks: {
    component: [],
  },
};

export default myExtension;
```

For more detail, see [DOCS/EXTENSIONS.md](./DOCS/EXTENSIONS.md).

## Works With `nexiq-ui`

The sibling `nexiq-ui` repository provides the desktop interface for browsing the analysis data produced here.

- `nexiq-ui` resolves local dependencies from `../nexiq/packages/...`
- the Electron app starts or connects to the backend server package
- shared types and extension contracts flow between both repositories

If you are developing the UI locally, build the relevant packages in this repo first so the app can resolve the expected outputs.

## Development Notes

- This is a pnpm workspace with packages under `packages/*` plus benchmark and sample-project folders.
- Some workflows assume the sample projects in `packages/sample-project/*` are available for local analysis and testing.
- The backend server starts an MCP stdio transport and a WebSocket server, which is how the desktop app connects during local development.
