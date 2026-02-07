---
phase: 10-inline-reply-to
plan: 01
subsystem: chat-backend
tags: [convex, schema, messages, reply-to, enrichment]
requires: [09-user-mentions-in-chat]
provides:
  - messages.replyToId field
  - messages.send accepts replyToId
  - enriched parent message info in list/search/context queries
affects: [10-02, 10-03]
tech-stack:
  added: []
  patterns:
    - batch-fetch parent messages with getAll
    - enrich queries with replyTo metadata
    - handle deleted/missing parents gracefully
key-files:
  created: []
  modified:
    - convex/schema.ts
    - convex/messages.ts
    - shared/types/channel.ts
decisions:
  - slug: no-parent-validation-in-send
    title: No parent message validation in send mutation
    rationale: Intentionally skip validation that parent exists/isn't deleted - the query layer handles deleted state gracefully and users can still send if parent was deleted between clicking Reply and sending
  - slug: batch-fetch-parent-users
    title: Separate batch-fetch for parent message authors
    rationale: Parent message authors may not be in current page's userMap (if they didn't send a message in the visible page), so we fetch missing parent users separately to ensure replyTo.author is always populated
  - slug: precise-return-validators
    title: Use precise v.union validators instead of v.any()
    rationale: Following CLAUDE.md guidance - replyTo field uses v.union(v.null(), v.object(...)) for type safety rather than v.any()
metrics:
  duration: 3.5 min
  completed: 2026-02-07
---

# Phase 10 Plan 01: Reply-to Backend Support Summary

**One-liner:** Messages can reference parent messages via replyToId; list/search/context queries return enriched parent info (author, plainText, deleted).

## Overview

Added backend support for reply-to functionality at the data layer. Messages table now has an optional replyToId field, the send mutation accepts it, and all message queries (list, search, getMessageContext) return enriched parent message metadata including author name, plainText preview, and deleted status. This enables the frontend to render quote previews without additional queries.

## What Was Built

### Schema Extension
- Added `replyToId: v.optional(v.id("messages"))` to messages table
- No index needed (we don't query "all replies to message X" in v0.9)

### Send Mutation Update
- Accepts optional `replyToId` parameter
- Stores it with the message (Convex omits undefined optional fields)
- No validation on parent existence (intentional - query layer handles gracefully)

### Query Enrichment (list, search, getMessageContext)
- Batch-fetch parent messages using `getAll(ctx.db, parentIds)`
- Batch-fetch parent message authors not in current page's userMap
- Return `replyTo` object with:
  - `author`: parent message author name
  - `plainText`: parent message text for preview
  - `deleted`: true if parent is deleted, false otherwise
- Return `replyTo: null` if message isn't a reply or parent doesn't exist

### Type Updates
- Created `ReplyToInfo` type: `{ author: string; plainText: string; deleted: boolean; } | null`
- Extended `MessageWithAuthor` interface to include `replyTo: ReplyToInfo`
- Updated all query return validators with precise `v.union()` types

## Key Architectural Decisions

**No parent validation in send mutation**
The send mutation intentionally does NOT validate that the parent message exists or isn't deleted. This is a UX decision: if a user clicks Reply on a message and that message gets deleted before they hit Send, their reply should still send. The query layer handles the deleted state gracefully by setting `replyTo.deleted: true`.

**Batch-fetch parent users separately**
Parent message authors might not appear in the current page's message list (e.g., replying to an old message). We collect parent user IDs that aren't in the existing userMap and batch-fetch them separately to ensure `replyTo.author` is always populated with a valid name.

**Precise return validators**
Following CLAUDE.md guidance, we use `v.union(v.null(), v.object({ author: v.string(), plainText: v.string(), deleted: v.boolean() }))` instead of `v.any()` for type safety. This ensures TypeScript knows the exact shape of the replyTo field.

## Task Commits

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | Add replyToId to schema and send mutation | b4b747b | convex/schema.ts, convex/messages.ts |
| 2 | Enrich queries with parent message info | 0c8d063 | convex/messages.ts, shared/types/channel.ts |

## Deviations from Plan

None - plan executed exactly as written.

## Blockers/Issues Discovered

None.

## Next Phase Readiness

**Ready for 10-02 (Reply UI Components):** Backend is complete. Frontend can now:
- Send messages with `replyToId`
- Display parent message quotes using `replyTo.author` and `replyTo.plainText`
- Show "[message deleted]" state when `replyTo.deleted === true`
- Handle missing parents (`replyTo === null`)

**Dependencies satisfied:**
- Schema supports replyToId ✓
- Send mutation accepts replyToId ✓
- Queries return enriched parent info ✓
- Deleted parents handled gracefully ✓
- TypeScript types updated ✓

## Testing Notes

To verify:
1. Open Convex dashboard → messages table should show replyToId field
2. Send a message with replyToId (via direct mutation call)
3. Query messages.list → should see replyTo object with author/plainText
4. Delete the parent message
5. Query messages.list again → replyTo.deleted should be true
6. Send a message with replyToId pointing to non-existent message
7. Query messages.list → replyTo should be null

## Self-Check: PASSED

All key files modified exist:
- convex/schema.ts ✓
- convex/messages.ts ✓
- shared/types/channel.ts ✓

All commits exist:
- b4b747b ✓
- 0c8d063 ✓
