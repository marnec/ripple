---
phase: quick-1
plan: 01
subsystem: task-management
tags: [bugfix, blocknote, crash-fix]
dependency-graph:
  requires: []
  provides: [safe-blocknote-description-loading, safe-comment-block-creation]
  affects: [TaskDetailSheet, TaskComments]
tech-stack:
  added: []
  patterns: [try-catch-json-parse, crypto-randomUUID-block-ids]
key-files:
  created: []
  modified:
    - src/pages/App/Project/useTaskDetail.ts
    - src/pages/App/Project/TaskComments.tsx
decisions:
  - Use crypto.randomUUID() for BlockNote block id generation
  - Empty paragraph with id as safe fallback for corrupted/missing descriptions
metrics:
  duration: 2 min
  completed: 2026-02-10
---

# Quick Task 1: Fix "Block doesn't have id" Error Summary

Safe BlockNote block creation with crypto.randomUUID() ids and try-catch for corrupted JSON descriptions.

## What Was Done

### Task 1: Fix useTaskDetail.ts description loading (8de21ab)

- Wrapped `JSON.parse(task.description)` in try-catch to handle corrupted/invalid JSON gracefully
- Replaced empty `[]` fallback with properly-structured empty paragraph block containing `id` field via `crypto.randomUUID()`
- On parse failure, falls through to the same safe empty-block path

### Task 2: Fix TaskComments.tsx block creation (03ee162)

- Added `id: crypto.randomUUID()` to plain-text fallback in `parseCommentBody` function
- Added `id: crypto.randomUUID()` to editor clear block after comment submission in `handleSubmit`

## Deviations from Plan

None - plan executed exactly as written.

## Verification

- `npm run lint` passes with 0 warnings
- `npm run build` completes successfully

## Commits

| Task | Commit  | Description                                          |
|------|---------|------------------------------------------------------|
| 1    | 8de21ab | Safe description loading with try-catch and fallback |
| 2    | 03ee162 | Add id fields to BlockNote blocks in TaskComments    |

## Self-Check: PASSED
