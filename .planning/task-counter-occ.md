# Task Counter OCC Contention

## Problem

`tasks.ts:162-166` increments `project.taskCounter` on every task creation, creating a serialization point under Convex's optimistic concurrency control. Concurrent creates on the same project cause O(N) retries.

## Current Status: Accepted

Low task-creation rates per-project make this a non-issue at current scale. Convex retries are automatic and transparent.

## If It Becomes a Problem

**Trigger:** Bulk import feature, or high-concurrency task creation.

### Option 1: Bulk create in single mutation (preferred for import)
Create all tasks in one transaction — one counter read, one `+N` patch. No OCC contention.

### Option 2: Delayed numbering (preferred for high-concurrency)
1. Insert task with `taskNumber: undefined`
2. Schedule internal mutation to increment counter + patch task number
3. Brief window where task has no number (acceptable since number is for reference/search)

### Ruled Out
- **Random IDs** — Loses human-readable `ENG-42` numbering (core UX feature)
- **Sharded counters** — Over-engineered for this use case
