# nexiq

`nexiq` is the analysis and backend core for exploring React component relationships, project structure, and extension-powered graph workflows.

## Nexiq UI

The companion desktop application for `nexiq` provides an interactive graph visualization of your codebase.

- **Repository**: [Naputt1/nexiq-ui](https://github.com/Naputt1/nexiq-ui)
- Renders interactive component dependency graphs.
- Provides deep-dive views for props, hooks, and project structure.
- Integrates with the backend server via WebSockets.

## Installation

You can install the `nexiq` CLI globally via npm:

```bash
npm install -g @nexiq/cli
```

Once installed, you can use the `nexiq` command to manage the background analysis server.

## Model Context Protocol (MCP)

`nexiq` implements the [Model Context Protocol](https://modelcontextprotocol.io/), allowing LLMs like Claude to navigate and understand your React codebase.

### Configuration for Claude Desktop

Add the following to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "nexiq": {
      "command": "nexiq",
      "args": ["start", "--foreground"]
    }
  }
}
```

## Key Features

- Analyze React and TypeScript codebases into graph data that can be inspected or consumed by other tools.
- Run an MCP-compatible backend server for project-aware tooling and editor or agent integrations.
- Share common graph, data, and SQLite-backed utilities across packages with `@nexiq/shared`.
- Build custom extensions that add graph tasks, UI sections, and MCP tools.

## How The Packages Fit Together

- `@nexiq/analyser` parses projects and produces the component and dependency graph data.
- `@nexiq/server` runs the backend server and project management layer, including MCP and WebSocket support.
- `@nexiq/cli` is the command-line interface for managing and interacting with the nexiq server.
- `@nexiq/shared` contains shared types, utilities, and database helpers used across the stack.
- `@nexiq/extension-sdk` provides the extension interface for adding custom tasks and tooling around nexiq.

## Development

### Requirements

- Node.js
- `pnpm` 10+

### Install Dependencies

```bash
pnpm install
```

### Common Commands

```bash
pnpm build:analyze       # Build the analyser package
pnpm dev:server           # Run the server in dev mode
pnpm dev:cli              # Run the CLI in dev mode
pnpm test:analyze         # Run analyser tests
pnpm snapshot:analyze     # Update analyser snapshots
pnpm benchmark            # Run performance benchmarks
pnpm typecheck            # Run type-checking across workspace
pnpm lint                 # Run linting with autofix
```

### Package-Level Entry Commands

Useful commands exposed by the main packages:

```bash
pnpm --filter=@nexiq/analyser build
pnpm --filter=@nexiq/analyser start
pnpm --filter=@nexiq/analyser snapshot
pnpm --filter=@nexiq/server dev
pnpm --filter=@nexiq/server start
pnpm --filter=@nexiq/cli dev
pnpm --filter=@nexiq/cli start
```

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
