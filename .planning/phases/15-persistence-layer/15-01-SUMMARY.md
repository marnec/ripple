---
phase: 15-persistence-layer
plan: 01
subsystem: backend-storage
tags: [convex, yjs, persistence, http-endpoints, file-storage]

dependency_graph:
  requires: [14-01]
  provides: [snapshot-persistence-api]
  affects: [convex-schema, diagram-creation]

tech_stack:
  added: [convex-file-storage]
  patterns: [server-to-server-auth, binary-blob-storage]

key_files:
  created:
    - convex/snapshots.ts
  modified:
    - convex/schema.ts
    - convex/diagrams.ts
    - convex/http.ts

decisions:
  - context: "Schema field naming"
    decision: "Use yjsSnapshotId (not just snapshotId) to make it clear this is Yjs-specific binary data"
    rationale: "Avoids confusion with potential future snapshot types"

  - context: "Room ID parsing in HTTP actions"
    decision: "Inline the roomId parsing logic instead of importing from shared/protocol/rooms"
    rationale: "Convex HTTP actions are bundled separately and may not resolve relative imports outside convex/. Inlining 5 lines of parsing avoids import resolution issues."

  - context: "Legacy diagram content field"
    decision: "Remove content field from diagrams schema and validator"
    rationale: "Yjs is now the single source of truth for diagram state. Legacy Excalidraw JSON no longer needed."

  - context: "Snapshot deletion on update"
    decision: "Delete old snapshot file when saving new one"
    rationale: "Prevents unbounded storage growth. Each resource should have at most one snapshot at a time."

metrics:
  duration_seconds: 193
  duration_minutes: 3.2
  tasks_completed: 2
  files_created: 1
  files_modified: 3
  commits: 2
  completed_date: 2026-02-12
---

# Phase 15 Plan 01: Snapshot Persistence Infrastructure Summary

**One-liner:** Convex backend infrastructure for binary Yjs snapshot persistence with HTTP endpoints for PartyKit to save and load document state to/from file storage.

## What Was Built

### Schema Changes (convex/schema.ts)
- Added `yjsSnapshotId: v.optional(v.id("_storage"))` to three tables:
  - `documents` - links document to its Yjs snapshot
  - `diagrams` - links diagram to its Yjs snapshot
  - `tasks` - links task description to its Yjs snapshot
- Removed legacy `content: v.optional(v.string())` field from diagrams table (Yjs is now single source of truth)

### Snapshot Module (convex/snapshots.ts)
New internal module for snapshot persistence operations:

**`saveSnapshot` (internalMutation):**
- Accepts resourceType (doc/diagram/task), resourceId, and storageId
- Updates resource document with new yjsSnapshotId
- Deletes old snapshot file if one exists (prevents storage bloat)
- Handles resource deletion gracefully (logs warning, continues)

**`getSnapshot` (internalQuery):**
- Accepts resourceType and resourceId
- Returns storageId for the resource's current snapshot
- Returns null if resource doesn't exist or has no snapshot

### HTTP Endpoints (convex/http.ts)
Two new server-to-server endpoints for PartyKit integration:

**POST /collaboration/snapshot:**
- Accepts binary Yjs snapshot data from PartyKit
- Authenticates via `Authorization: Bearer <PARTYKIT_SECRET>` header
- Extracts roomId from query params (format: `{resourceType}-{resourceId}`)
- Stores blob in Convex file storage via `ctx.storage.store()`
- Links snapshot to resource via `saveSnapshot` mutation
- Returns 200 with `{ success: true }` on success

**GET /collaboration/snapshot:**
- Serves binary Yjs snapshot data for PartyKit cold-start hydration
- Same authentication and roomId parsing as POST
- Retrieves storageId via `getSnapshot` query
- Fetches blob from storage via `ctx.storage.get()`
- Returns blob with `Content-Type: application/octet-stream`
- Returns 404 if no snapshot exists

**Security:**
- Both endpoints require `PARTYKIT_SECRET` environment variable
- Shared secret authentication (server-to-server, not user tokens)
- Logs error if PARTYKIT_SECRET not configured
- No CORS headers needed (server-to-server only)

### Diagram Creation Update (convex/diagrams.ts)
- Removed `content` field from `diagramValidator`
- Removed `content: JSON.stringify(...)` from `create` mutation
- New diagrams start with empty Yjs state (no legacy JSON seeding)

## Deviations from Plan

None - plan executed exactly as written.

## Technical Implementation Details

### TypeScript Type Safety
- Used conditional logic with explicit type assertions instead of computed table names
- Avoids ESLint warnings about unused variables in type-only contexts
- Each resource type gets explicit `ctx.db.get()` and `ctx.db.patch()` calls

### Room ID Parsing
- Inlined parsing logic in HTTP handlers (split on first `-`, validate type)
- Avoids import resolution issues with `../shared/protocol/rooms` in HTTP actions
- Same logic as shared parseRoomId function but self-contained

### Error Handling
- Comprehensive try/catch blocks in both HTTP endpoints
- Specific error messages for each failure case (400, 401, 404, 500)
- Console logging for debugging (especially auth configuration issues)
- Graceful handling of deleted resources in saveSnapshot

## Verification Results

All verification criteria passed:
- `npm run lint` - 0 warnings
- `npm run build` - successful
- Schema has yjsSnapshotId on documents, diagrams, and tasks
- Schema does NOT have content field on diagrams
- convex/snapshots.ts exports saveSnapshot and getSnapshot
- convex/http.ts has POST and GET /collaboration/snapshot routes
- Both routes validate PARTYKIT_SECRET authorization

## Integration Points

**For PartyKit (Phase 15-02):**
- POST snapshot: `https://{convex-host}/collaboration/snapshot?roomId={roomId}` with binary body
- GET snapshot: `https://{convex-host}/collaboration/snapshot?roomId={roomId}` returns binary
- Must include `Authorization: Bearer {PARTYKIT_SECRET}` header

**Configuration Required:**
```bash
npx convex env set PARTYKIT_SECRET <shared-secret-value>
```

## Success Criteria Met

- [x] Convex file storage can receive and store binary Yjs snapshots from PartyKit
- [x] Each resource table has yjsSnapshotId field linking to _storage
- [x] POST endpoint exists for PartyKit to send snapshot data
- [x] GET endpoint exists for PartyKit to retrieve snapshots for cold-start
- [x] Legacy diagrams.content field removed from schema
- [x] Snapshot save/load mutations work for all three resource types

## Self-Check: PASSED

**Created files verified:**
- convex/snapshots.ts exists

**Modified files verified:**
- convex/schema.ts contains yjsSnapshotId on documents, diagrams, tasks
- convex/schema.ts does NOT contain content on diagrams
- convex/diagrams.ts validator updated
- convex/http.ts has both snapshot endpoints

**Commits verified:**
- 6b00883: feat(15-01): add yjsSnapshotId to schema and create snapshot mutations
- 73fa4d0: feat(15-01): add HTTP endpoints for snapshot save and load
