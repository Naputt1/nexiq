---
name: nexiq-mcp
description: Optimize tool selection, field filtering, and call ordering when using nexiq MCP tools for React/TypeScript codebase exploration.
---

# Nexiq MCP Skill

Efficient codebase exploration with nexiq's specialized tools.

## Core Principles

1. **Use the most specific tool** — narrow the search space at each step
2. **Request only needed fields** — use the `fields` param to exclude unnecessary data
3. **Batch related queries** — one `get_symbol_info` with `usages: true` is cheaper than two calls
4. **Read content via `get_symbol_content`** — not `read_file` — returns only the relevant symbol

## Scope & Limitations

Nexiq's specialised tools (`get_symbol_info`, `get_symbol_content`, `get_prop_definitions`, `get_field_accesses`, `trace_data_flow`, `get_component_hierarchy`) only work for **source code within the open project** that has been analyzed by the static analysis pipeline. They do **NOT** work for:

- External dependencies in `node_modules/`
- Symbols from imported packages (`@mattermost/components`, etc.)
- Code in sub-packages not included in analysis scope

**How to detect:** These tools return `"Symbol not found"`, `{definitions: []}`, `{props: []}`, or empty `results: []` when the symbol is outside analysis scope.

**Fallback:** When specialised tools fail, use generic tools instead:

```
find_files(pattern: "**/ComponentName*")
  → locate the file anywhere in the project
grep_search(pattern: "ComponentName")
  → find references across all source files
read_file(filePath)
  → read source directly when tools can't parse it
```

## Optimal Tool Sequences

### Finding and understanding a component

```
get_symbol_info("ComponentName", usages: true)
  → identifies definition file + all usages
get_symbol_content("ComponentName")
  → reads just the component source (not the whole file)
get_prop_definitions("ComponentName")
  → if you need typed prop details
```

### Tracing a prop from usage to origin

```
get_field_accesses("useUser", "data.role")
  → finds every file accessing user.data.role
get_symbol_info("LoginForm", usages: true)
  → if you need the component calling useUser
```

### Tracing data flow through the component hierarchy

```
trace_data_flow("PostList", "postListIds")
  → walks up from PostList through parent renders
  → each step shows what expression is passed as postListIds
  → if the expression is a prop reference, recurses up automatically
  → returns chain: [{component, renderLoc, expression}]
```

Use `trace_data_flow` instead of manually walking the render tree to find where a prop value originates. It handles multi-hop parent chains automatically up to `maxDepth` (default 3).

### Exploring monorepo workspace packages

```
get_workspace_info(projectPath)
  → lists all workspace packages (name, path, file count, analysis status)
  → use first to understand the monorepo structure
  → returns isMonorepo: false if not a monorepo
```

### Finding symbols across packages

```
search_workspace_symbol(symbol: "GenericModal")
  → searches package_export_index across all packages
  → returns which package exports it, file path, and export type
  → use when get_symbol_info returns empty definitions
  → hint on get_symbol_info automatically suggests this
```

### Checking a file's external imports

```
get_package_imports(filePath: "packages/app/src/App.tsx")
  → returns all imports from the file, annotated with resolved package info
  → shows which workspace package each import resolves to
  → use to understand cross-package dependencies

### Understanding render relationships

```
get_component_hierarchy("ComponentName", depth: 2)
  → parent/child render tree (both directions)
  renderedBy tells you which components render this one
```

### Traversing the dependency graph

```
get_symbol_info("ComponentName", usages: true)
  → get the symbol IDs from definitions[].id
get_relations(symbolId: "<id from above>")
  → returns all incoming/outgoing graph edges
  → filter by kind: "render", "import", "usage-read", "usage-call"
  → use direction: "incoming" for what uses this, "outgoing" for what this uses
```

### Chaining graph traversal for deep paths

```
get_relations(symbolId: "<parent>", direction: "incoming", kind: "render")
  → find what renders this component
get_relations(symbolId: "<grandparent>", direction: "outgoing", kind: "render")
  → find what the grandparent renders (siblings)
```

Use `get_relations` to replace 5+ hops of manual `read_file` + grep when tracing data flow through the component tree.

### Finding files without full listing

```
find_files(pattern: "**/Button*")
  → finds files matching pattern
get_file_imports(filePath: "src/App.tsx")
  → reads imports only (avoids reading the file)
```

## Field Filtering

Every tool accepts an optional `fields` array. Use it to reduce response size:

| Tool | Useful filters | Saves |
|------|---------------|-------|
| `get_symbol_info` | `["definitions"]` | Excludes usages, ~60-80% smaller |
| `list_files` | `["path"]` | Excludes exports, ~50% smaller |
| `get_file_outline` | `["name","line"]` | Excludes type metadata |
| `get_symbol_location` | `["file","line"]` | Excludes kind/type |
| `get_prop_definitions` | `["name","type"]` | Excludes defaults |
| `trace_data_flow` | `["chain"]` | Excludes notes |
| `search_workspace_symbol` | `["matches"]` | Excludes package totals |
| `get_package_imports` | `["imports"]` | Excludes file metadata |

Default returns all fields. Always specify `fields` when you don't need everything.

## StructuredContent

Tool results include a `structuredContent` field with native JSON — no parsing needed:

```typescript
// Direct access instead of JSON.parse(content[0].text):
const { definitions, externalUsages } = result.structuredContent;

// Array-returning tools use .items:
const matches = result.structuredContent.items;
```

Results in `content[0].text` also contain the full JSON string (backward compatible).

## Empty Results & Hints

When a tool returns empty results, it may include a `hint` field explaining why:
- `find_files` returning `[]` → hint may suggest the file is in an external monorepo package
- `list_directory` returning `{directories:[], files:[]}` → hint suggests checking root `/` first
- `get_symbol_info` returning `{definitions: []}` → hint suggests using `search_workspace_symbol` to find it in a monorepo package
- `get_component_hierarchy` returning `{error: "..."}` → hint suggests using `grep_search` as fallback

Treat empty results with a `hint` as diagnostic feedback, not dead ends. Switch strategy.

## Anti-Patterns

| Avoid | Use instead |
|-------|-------------|
| `grep_search` for component usages | `get_symbol_info(query, usages: true)` |
| `grep_search` for field access patterns | `get_field_accesses(hook, fieldPath)` |
| `read_file` to read a component | `get_symbol_content(query)` |
| `read_file` to read imports | `get_file_imports(filePath)` |
| `run_shell_command` for any search | One of the specialized tools above |
| Multiple calls for related symbols | One call with `usages: true` |
| Omitting `fields` param | Always specify to reduce response size |
| Manual parent chain traversal for props | `trace_data_flow(component, fieldPath)` — 1 call instead of 12+ |
| Getting stuck when symbol not found | `search_workspace_symbol(symbol)` — finds it across all packages |
| `find_files` spiraling on monorepos | `get_workspace_info` + `search_workspace_symbol` to locate the right package |

## Token Budget Tips

- `get_symbol_info` without `usages` is ~80% smaller than with usages
- `get_symbol_info` with `contextLines > 0` returns flat usage array — use only when surrounding code is needed
- `list_files` caps at 50 files for large projects — use `find_files` or `list_directory` for specific queries
- `get_component_hierarchy` with `depth: 1` is enough for most questions
- Default excludes (node_modules, test, build) are already applied to all tools
- **`grep_search` searches all project files** — not just analyzed files. It costs ~20 tokens per call, making it the cheapest fallback when specialised tools fail. Always use `grep_search` over `run_shell_command` for text searches.
