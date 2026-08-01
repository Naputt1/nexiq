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

### Token Optimization

For efficient MCP tool usage — optimal tool sequences, field filtering, and anti-patterns — see the [nexiq MCP skill](docs/skills/nexiq-mcp.md).

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
pnpm benchmark:analysis   # Benchmark serial vs parallel analysis
pnpm typecheck            # Run type-checking across workspace
pnpm lint                 # Run linting with autofix
```

The analysis benchmark (`benchmarks/analysis`) compares `analyzeProject` with a
true single-threaded run (`fileWorkerThreads: 1`, `packageConcurrency: 1`)
against a parallel run, reporting wall time, peak memory, and a per-phase
breakdown:

```bash
pnpm benchmark:analysis                                          # all projects, 3 reps
pnpm benchmark:analysis -- --projects=small,large --reps=3 --threads=8 --package-concurrency=2
pnpm benchmark:analysis -- --projects=large --no-sqlite          # skip SQLite persistence
```

Flags: `--projects` (comma-separated tier names), `--reps` (default 3),
`--threads` (parallel file worker threads, default CPU count),
`--package-concurrency` (parallel workspace packages for monorepos; default auto),
`--no-sqlite` (skip SQLite persistence — SQLite writes are ~2/3 of monorepo analysis
time; see the `persist` option on `analyzeProject`), `--out` (results path).
Results land in `benchmarks/results/analysis/`.

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
