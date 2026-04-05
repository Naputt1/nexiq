# Plan: Analyser Monorepo Architecture

This document tracks the long-term analyser refactor toward package-master based analysis, authoritative package/workspace persistence, cross-package graphing, and preserved `analyzeProject(): Promise<JsonData>` compatibility.

## Goals

- Preserve `analyzeProject(): Promise<JsonData>`.
- Keep package DBs and workspace DB authoritative.
- Support monorepo package discovery, package-local analysis, central cross-package resolution, and compatibility-layer merged graphs.
- Improve correctness in small, testable iterations rather than attempting full semantic unification in one pass.

## Architectural Baseline

The current architecture is package-scoped first, then workspace-integrated. Package masters own package-local orchestration and file workers produce per-file analysis results. Package SQLite databases persist analysis runs, file status, and package-local errors. A workspace database persists workspace runs, discovered packages, export indexes, deferred external imports, inter-package relations, and cross-package resolve errors. The merged monorepo `JsonData` output is still a compatibility artifact, but it now uses workspace-qualified identities so cross-package stitching can be layered on top without file-path collisions.

Authoritative orchestration surfaces:

- `packages/analyser/src/packageMaster.ts`
- `packages/analyser/src/centralMaster.ts`
- `packages/analyser/src/db/componentDB.ts`
- `packages/analyser/src/db/fileDB.ts`
- `packages/analyser/src/workspaceSqlite.ts`

## Progress Tracker

### Completed

- [x] Package-master orchestration
- [x] Package/local run and error persistence
- [x] Central workspace DB and phase 2 merge
- [x] Workspace-qualified merged identities
- [x] Run-scoped `package_relations`
- [x] Cross-package import edges
- [x] Cross-package render stitching
- [x] Cross-package hook stitching
- [x] Named imported type-ref stitching
- [x] Namespace-qualified type-ref stitching
- [x] `import("pkg").Type` and `typeof import()` stitching

### In Progress

- None

### Not Started

- [ ] Multi-hop namespace chains
- [ ] Broader `TSTypeQuery` semantics
- [ ] Cross-package render/dependency semantic unification beyond compatibility stitching
- [ ] Cross-package symbol identity / true canonical symbol graph
- [ ] Cross-package type graph semantics beyond payload rewriting
- [ ] Package `exports` map fidelity beyond heuristic entry/subpath matching

## Phased Roadmap

### 1. Phase 1: Package-Scoped Analysis and Persistence

- Status: complete
- Purpose: establish package-local orchestration and durable package analysis state.
- Scope:
  - package master orchestration
  - run/file/error persistence
  - last-good canonical file retention
- Acceptance:
  - package-local failures persist without losing last good data
  - analyser/package/server typechecks pass

### 2. Phase 2: Workspace Merge and Cross-Package Import Resolution

- Status: complete
- Purpose: add workspace-wide orchestration and a correct central import-resolution layer.
- Scope:
  - workspace discovery
  - workspace DB
  - export index
  - deferred external imports
  - central import resolution
  - merged workspace-qualified `JsonData`
- Acceptance:
  - duplicate package-relative paths do not collide
  - `package_relations` are run-scoped
  - import edges and unresolved cross-package tasks appear correctly

### 3. Phase 3: First Semantic Stitching Layer

- Status: complete
- Purpose: stitch the first set of cross-package semantic payloads on top of central import resolution.
- Scope:
  - cross-package render edges
  - cross-package hook edges
  - named imported type refs
  - namespace-qualified type refs
  - `import("pkg").Type`
  - `typeof import()`
- Acceptance:
  - no package-local retry-loop warnings/errors for workspace-classified hook/type work
  - resolved references rewrite to canonical export IDs in merged graph payloads
  - unresolved workspace refs surface only through central unresolved channels

### 4. Phase 4: Export Map Fidelity and Resolver Correctness

- Status: next
- Purpose: reduce heuristic mismatch in central cross-package resolution.
- Scope:
  - interpret package `exports` maps more accurately
  - tighten subpath/default/type export matching
  - reduce heuristic ambiguity and false negatives
- Acceptance:
  - explicit tests for subpath exports and conditional/default/type cases
  - central resolve errors reflect true unresolveds rather than unsupported matching

### 5. Phase 5: Deeper Cross-Package Semantic Linking

- Status: planned
- Purpose: move beyond the first stitching layer into broader semantic linkage.
- Scope:
  - multi-hop qualified refs
  - richer `TSTypeQuery` semantics
  - broader cross-package dependency/render stitching where payload data supports it
- Acceptance:
  - new semantic stitching works without changing public API
  - no regressions to existing import/render/hook/type cases

### 6. Phase 6: True Cross-Package Identity Model

- Status: long-term
- Purpose: replace compatibility-layer remapping with stable cross-package identities.
- Scope:
  - canonical symbol identity across packages
  - move beyond compatibility-layer payload rewriting
  - make merged graph more than a compatibility artifact
- Acceptance:
  - stable cross-package symbol identity independent of file-local placeholders
  - documented boundary between authoritative DB model and compatibility output

## Current Risks / Open Gaps

- Package export resolution is still heuristic
- No multi-hop namespace support
- No full `TypeDataImport` semantics beyond single qualifier
- No full cross-package symbol identity remapping
- Merged `JsonData` is still compatibility-oriented, not the source of truth
- Render/dependency stitching still depends on what package-local payloads already expose

## Verification Checklist

- [ ] `@nexiq/analyser` vitest suite passes
- [ ] analyser `tsc --noEmit` passes
- [ ] shared `tsc --noEmit` passes
- [ ] CLI/server package `tsc --noEmit` passes
- [ ] new monorepo regression added for every cross-package capability
- [ ] new unresolved-case regression added whenever central-only resolution behavior changes

## Exit Criteria

- Workspace analysis is authoritative in package/workspace DBs
- Cross-package imports/hooks/types/render relationships are resolved with low false-positive/false-negative rates
- Unresolved work is classified centrally rather than leaking into package-local retry/error paths
- `analyzeProject(): Promise<JsonData>` remains supported until downstream consumers migrate away from compatibility output
- Remaining unsupported TS/module cases are explicitly documented

## Iteration Maintenance

1. Add `plan/analyser-monorepo.md` with the structure above and mark already completed phases based on the current codebase state.
2. After each implementation phase, update only three areas:
   - `Progress Tracker`
   - the current phase’s status/acceptance bullets
   - `Current Risks / Open Gaps`
3. When a new implementation slice is chosen, add it to the next incomplete phase rather than creating ad hoc sections.
4. Only create a new phase when the work changes architectural level, not just because a test or edge case was added.
5. Keep the doc concise: it should be a status artifact and execution roadmap, not a changelog.
