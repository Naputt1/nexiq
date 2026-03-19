# Plan: MCP-Centric Architecture

Transition `nexiq` from a UI-focused visualization tool to an MCP-first (Model Context Protocol) code exploration platform.

## Goals

1.  **Reduce Token Usage**: Optimize graph traversal and symbol lookup so LLMs can find specific code locations (definitions, usages, props) without broad file searching.
2.  **Universal Backend**: A shared `ProjectManager` and server that provides data to both the MCP server and the Electron UI.
3.  **Extensible Tools**: Allow extensions to register custom MCP tools (e.g., TanStack Router route listing, Query hook discovery).
4.  **Real-time Synchronization**: Use file watchers to keep the graph data current for both interfaces.

## Architecture

- **`packages/mcp`**: The primary entry point. A standalone MCP server providing tools for code exploration.
- **`packages/server`**: Shared logic for project management, analysis, and a WebSocket server for UI integration.
- **`packages/analyser`**: Core Babel-based parsing engine.
- **`packages/ui`**: Electron desktop app, now a consumer of the shared backend via WebSocket.

## Current Progress

- [x] Refactor `packages/mcp` to use a data-driven approach instead of UI automation.
- [x] Implement shared `ProjectManager` with `@parcel/watcher` support.
- [x] Implement dynamic extension loading in the backend.
- [x] Update `Extension` SDK to support `mcpTools`.
- [x] Connect Electron UI to the shared backend via WebSocket.
- [x] Add MCP tools to TanStack Router and Query extensions.
- [x] **Unified Server Package**: Fully merged core logic into `packages/server` as a reusable library.
- [x] **Enhanced Symbol Search**: Implemented robust cross-file definition and usage tracking in `get_symbol_info`.
- [x] **State Synchronization**: UI node positions and app state are now synced and persisted by the shared backend.

## Next Steps

- [x] **Unified Server Package**: Fully merge `packages/mcp` and `packages/server` into a single high-performance backend.
- [ ] **Enhanced Symbol Search**: Improve `get_symbol_info` to handle complex cross-file dependencies and re-exports more accurately.
- [ ] **State Synchronization**: Sync UI state (like node positions or selected items) back to the backend so the MCP server can refer to the "current view".
- [ ] **Multi-Project Management**: Improve the `ProjectManager` to handle multiple workspace projects concurrently and efficiently.
- [x] **Token Optimization**: Implemented `get_component_hierarchy` for surgical, depth-limited render tree retrieval.
- [ ] **Documentation**: Document the custom `nexiq.config.json` schema and how to write MCP extensions.
