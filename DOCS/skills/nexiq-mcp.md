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

### Understanding render relationships

```
get_component_hierarchy("ComponentName", depth: 2)
  → parent/child render tree (both directions)
```

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

## Token Budget Tips

- `get_symbol_info` without `usages` is ~80% smaller than with usages
- `get_symbol_info` with `contextLines > 0` returns flat usage array — use only when surrounding code is needed
- `list_files` caps at 50 files for large projects — use `find_files` or `list_directory` for specific queries
- `get_component_hierarchy` with `depth: 1` is enough for most questions
- Default excludes (node_modules, test, build) are already applied to all tools
