---
name: nexiq-mcp
description: Use nexiq for codebase comprehension — understand scope, trace data, and assess impact before making changes.
---

# Nexiq MCP Skill

Use nexiq for planning and comprehension. Use generic tools for editing. These are separate phases.

## Choosing Your Phase

| If the task is... | Your phases | Example |
|---|---|---|
| **Pure planning** ("find all files that X") | Phase 1 only | "List every file that imports Button" |
| **Pure coding** ("refactor X in file.tsx") | Phase 2 only | "Extract ButtonProps to types.ts" |
| **Hybrid** ("change X's API and update callers") | Phase 1 → Phase 2 | "Remove onClick from Button, update all callers" |

If the task names a specific file, it's pure coding — no planning needed.

## Phase 1: Plan with Nexiq

Use before opening any file. Each call replaces multiple manual steps.

### Find files affected by a change

```
get_symbol_info("ComponentName", usages: true)
  → every file that calls or renders it
```

### Trace where a value originates

```
trace_data_flow("ComponentName", "propName")
  → walks up the render tree automatically
  → returns chain: [{component, renderLoc, expression}]
```

### Find all files accessing a field

```
get_field_accesses("HookName", "field.path")
  → every file that reads that field through the hook
```

### Understand a component's dependencies

```
get_symbol_info("ComponentName", usages: true)      → get symbol IDs
get_relations(symbolId, direction: "outgoing")       → what it imports/renders
get_relations(symbolId, direction: "incoming")       → what renders it
```

### Explore a monorepo

```
get_workspace_info()                                 → list packages
search_workspace_symbol("SymbolName")                → find which package
get_symbol_info("SymbolName", usages: true)          → deep dive
```

### Skim a component without reading the file

```
get_symbol_content("ComponentName")                  → symbol body only
get_prop_definitions("ComponentName")                → typed props
get_component_hierarchy("ComponentName", depth: 1)   → render tree
```

## Phase 2: Code with Generic Tools

Once you know the scope, switch to generic tools and do not use nexiq again.

```
read_file(path)                         → full file context
replace_file_content(path, old, new)    → targeted edit
write_file(path, content)               → new file
run_shell_command("npm run check")       → verify
```

Only these four tools during this phase.

## Field Filtering

| Tool | Useful fields | Effect |
|------|--------------|--------|
| `get_symbol_info` | `["definitions"]` | Excludes usages, ~60-80% smaller |
| `trace_data_flow` | `["chain"]` | Excludes notes |
| `get_prop_definitions` | `["name","type"]` | Excludes defaults |
| `get_field_accesses` | `["results"]` | Excludes summary |
| `search_workspace_symbol` | `["matches"]` | Excludes package totals |
| `get_package_imports` | `["imports"]` | Excludes metadata |
| `get_component_hierarchy` | `["hierarchies"]` | Excludes metadata |

## Scope

Nexiq tools work on analyzed project source code. They do not work for `node_modules/`, external packages, or code outside the analysis scope.

**Detection**: `"Symbol not found"`, `{definitions: []}`, `{props: []}`, empty `results`.

**Fallback**: If a nexiq tool returns empty, the code is outside scope. Use `grep_search` or `read_file` instead. Do not chase external code.

## Tips

- `get_symbol_info` without `usages` is ~80% smaller
- `grep_search` costs ~20 tokens — cheaper than specialized tools for simple searches
- `projectPath` must be a directory, not a file path
- Default excludes (node_modules, test, build) are applied to all tools
