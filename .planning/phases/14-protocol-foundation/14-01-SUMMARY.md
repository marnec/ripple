---
phase: 14-protocol-foundation
plan: 01
subsystem: collaboration
tags: [protocol, type-safety, partykit, websocket, zod]
completed: 2026-02-12

dependency_graph:
  requires: []
  provides:
    - shared/protocol module with message types, error codes, and Zod schemas
    - Type-safe WebSocket protocol for PartyKit collaboration
  affects:
    - partykit/server.ts (imports error codes and message types)
    - src/hooks/use-yjs-provider.ts (imports ResourceType and error handling)

tech_stack:
  added:
    - Zod runtime validation for WebSocket messages
    - shared/protocol module for PartyKit-frontend type contract
  patterns:
    - Discriminated union pattern for type-safe message handling
    - ErrorCode enum with severity classification (recoverable vs terminal)
    - Barrel exports for clean protocol API surface

key_files:
  created:
    - shared/protocol/messages.ts (ClientMessage and ServerMessage types)
    - shared/protocol/errors.ts (ErrorCode enum and ERROR_SEVERITY mapping)
    - shared/protocol/schemas.ts (Zod schemas for runtime validation)
    - shared/protocol/rooms.ts (ResourceType, buildRoomId, parseRoomId utilities)
    - shared/protocol/index.ts (barrel exports)
  modified:
    - partykit/server.ts (typed error messages before connection close)
    - partykit/tsconfig.json (paths for @shared/* imports)
    - src/hooks/use-yjs-provider.ts (import ResourceType, typed error handling)

decisions:
  - title: "Use discriminated union pattern for WebSocket messages"
    rationale: "TypeScript discriminated unions provide exhaustive type checking and enable type-safe message handling. The `type` field acts as a discriminant, allowing the compiler to narrow types in switch statements."
    alternatives: ["Class hierarchy", "Type guards"]
    trade_offs: "Requires explicit type field on all messages, but provides superior compile-time safety."

  - title: "Error severity classification (recoverable vs terminal)"
    rationale: "Classify errors by whether client can retry. Auth/server errors are terminal (user intervention required), connection/sync errors are recoverable (automatic retry). Guides Phase 17 graceful degradation logic."
    alternatives: ["Per-error retry logic", "No classification"]
    trade_offs: "Simple binary classification may not cover all nuances, but provides clear guidance for 90% of cases."

  - title: "Send error message before WebSocket close"
    rationale: "WebSocket close reason is limited to 123 bytes and not reliably accessible in browsers. Sending a typed JSON error message before close allows client to read full error context (code + severity) for better UX."
    alternatives: ["Close reason only", "HTTP error response"]
    trade_offs: "Client must handle message before close event, but provides rich error context."

  - title: "PartyKit uses @shared/* path alias"
    rationale: "PartyKit tsconfig.json uses paths to resolve @shared/* to ../shared/*. PartyKit's esbuild bundler resolves these aliases at build time. If bundler doesn't support paths, fallback to relative imports is trivial."
    alternatives: ["Relative imports only", "npm workspace"]
    trade_offs: "Depends on bundler path resolution, but matches frontend convention."

metrics:
  duration_minutes: 4
  tasks_completed: 2
  files_created: 5
  files_modified: 3
  commits: 2
---

# Phase 14 Plan 01: Protocol Foundation Summary

**Type-safe WebSocket protocol with Zod validation for PartyKit collaboration**

## Overview

Formalized the implicit WebSocket communication between PartyKit server and frontend clients into a typed protocol contract. Created `shared/protocol/` module with TypeScript types, Zod runtime validation, error codes with severity classification, and room utilities. Both PartyKit server and frontend now import from a single source of truth, eliminating duplicate type definitions and catching protocol mismatches at compile time.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create shared protocol type definitions, error codes, and Zod schemas | e674d87 | shared/protocol/{messages,errors,schemas,rooms,index}.ts |
| 2 | Integrate shared protocol types into PartyKit server and frontend hook | 8dff1cc | partykit/{server,tsconfig}.ts, src/hooks/use-yjs-provider.ts |

## Key Deliverables

### Protocol Module Structure

**shared/protocol/messages.ts** - All WebSocket message types:
- `ClientMessage`: `auth`, `token_refresh`, `sync_request` (Phases 15-16)
- `ServerMessage`: `auth_ok`, `auth_error`, `error`, `user_joined`, `user_left`, `sync_complete`, `permission_revoked`, `service_status` (Phases 15-17)
- 30+ JSDoc comments documenting purpose, sender, receiver, expected actions
- `PROTOCOL_VERSION = 1` and `PROTOCOL_HEADER` for future version negotiation

**shared/protocol/errors.ts** - Error taxonomy:
- 18 error codes covering auth, room, sync, server, connection, persistence, token refresh, degradation
- `ERROR_SEVERITY` mapping: terminal (auth/server errors) vs recoverable (connection/sync/service errors)
- JSDoc on each error code explaining when/where it occurs

**shared/protocol/schemas.ts** - Zod runtime validation:
- `clientMessageSchema` and `serverMessageSchema` using `z.discriminatedUnion`
- `parseClientMessage` / `parseServerMessage` (throw on invalid)
- `safeParseClientMessage` / `safeParseServerMessage` (return success/error)
- `roomIdSchema` validates `{resourceType}-{resourceId}` format

**shared/protocol/rooms.ts** - Room utilities:
- `ResourceType` type: `"doc" | "diagram" | "task"`
- `buildRoomId(resourceType, resourceId)` - constructs room ID
- `parseRoomId(roomId)` - parses and validates room ID format
- `buildPartyKitUrl(host, roomId, token)` - constructs WebSocket URL

**shared/protocol/index.ts** - Barrel exports for clean API

### Integration Changes

**PartyKit Server** (`partykit/server.ts`):
- Imports `ErrorCode` and `ServerMessage` from `@shared/protocol`
- Sends typed error messages before closing WebSocket connection
- Uses `AUTH_MISSING`, `SERVER_CONFIG_ERROR`, `AUTH_INVALID`, `SERVER_INTERNAL_ERROR` error codes
- Type annotation on Convex verify endpoint response

**PartyKit TypeScript Config** (`partykit/tsconfig.json`):
- Added `paths: { "@shared/*": ["../shared/*"] }` for shared module imports
- Changed `rootDir` to `..` and `include` to include `../shared/**/*.ts`
- Enables PartyKit server to import from `@shared/protocol` (matches frontend convention)

**Frontend Hook** (`src/hooks/use-yjs-provider.ts`):
- Removed local `type ResourceType` definition (now imported from `@shared/protocol`)
- Imports `ResourceType`, `ErrorCode`, `ERROR_SEVERITY` from `@shared/protocol`
- Added typed error handling: checks error code and logs severity
- No behavioral changes (future Phase 17 will use error severity for retry logic)

## Verification Results

All verification criteria passed:

✅ **Type safety**: Both `tsconfig.app.json` and `partykit/tsconfig.json` pass without errors
✅ **Lint**: `npm run lint` passes with zero warnings
✅ **Build**: `npm run build` succeeds (production build)
✅ **Shared module**: 5 files exist in `shared/protocol/`
✅ **No duplicate types**: `ResourceType` only defined in `shared/protocol/rooms.ts`
✅ **Both consumers import**: `partykit/server.ts` and `src/hooks/use-yjs-provider.ts` both import from `@shared/protocol`
✅ **JSDoc coverage**: 30 JSDoc comments in `messages.ts` (>= 10 required)
✅ **Zod schemas**: 2 discriminated unions in `schemas.ts` (clientMessageSchema, serverMessageSchema)

## Deviations from Plan

None - plan executed exactly as written.

## What This Enables

### Phase 15 (Persistence Sync)
- `PERSIST_FAILED` and `PERSIST_STALE_SNAPSHOT` error codes ready
- `sync_complete` message type for persistence confirmation
- `sync_request` client message for full state requests

### Phase 16 (Token Refresh & Permission Re-validation)
- `AUTH_EXPIRED` and `TOKEN_REFRESH_REQUIRED` error codes
- `token_refresh` client message for token rotation without disconnect
- `permission_revoked` server message for real-time permission changes

### Phase 17 (Graceful Degradation)
- `SERVICE_UNAVAILABLE` and `DEGRADED_MODE` error codes
- `service_status` server message for health reporting
- Error severity classification guides retry vs user notification logic

### Immediate Benefits
- Single source of truth for protocol types (no duplicate definitions)
- Compile-time type checking catches protocol mismatches
- Runtime Zod validation catches malformed messages
- Better error context for debugging (typed error messages before close)
- Foundation for all future collaboration features

## Testing Notes

No runtime behavior changes in this phase. Existing collaboration features (Yjs sync, awareness) continue to work unchanged. The protocol types layer on top of the existing y-partykit wire protocol (which handles Yjs sync messages via ArrayBuffer).

Manual verification:
- Documents, diagrams, and tasks with collaboration still load and sync
- Connection errors still close with appropriate codes
- No console errors from protocol type mismatches

## Self-Check

✅ **Created files exist:**
```bash
FOUND: shared/protocol/messages.ts
FOUND: shared/protocol/errors.ts
FOUND: shared/protocol/schemas.ts
FOUND: shared/protocol/rooms.ts
FOUND: shared/protocol/index.ts
```

✅ **Commits exist:**
```bash
FOUND: e674d87 (Task 1 - protocol types and schemas)
FOUND: 8dff1cc (Task 2 - protocol integration)
```

✅ **Modified files exist:**
```bash
FOUND: partykit/server.ts
FOUND: partykit/tsconfig.json
FOUND: src/hooks/use-yjs-provider.ts
```

## Self-Check: PASSED

All files created, all commits exist, all modifications verified.
