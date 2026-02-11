---
phase: 11-partykit-infrastructure-persistence
plan: 01
subsystem: infrastructure
tags: [partykit, yjs, websocket, persistence, collaboration]
dependency-graph:
  requires: []
  provides:
    - partykit-dev-server
    - yjs-persistence
    - collaboration-infrastructure
  affects:
    - npm-dev-workflow
    - deployment-pipeline
tech-stack:
  added:
    - PartyKit 0.0.115 (dev dependency)
    - yjs 13.6.29
    - y-partykit 0.0.33
  patterns:
    - Yjs WebSocket sync with snapshot mode persistence
    - Durable Objects for room isolation
    - Parallel dev server startup (Vite + Convex + PartyKit)
key-files:
  created:
    - partykit.json: PartyKit project configuration (port 1999, snapshot persist)
    - partykit/server.ts: Yjs collaboration server using y-partykit onConnect
    - partykit/tsconfig.json: TypeScript config for PartyKit server code
  modified:
    - package.json: Updated dev and deploy scripts, added PartyKit dependencies
    - .gitignore: Added .partykit/ directory exclusion
decisions:
  - desc: Use snapshot mode persistence instead of history mode
    rationale: Automatic compaction on last client disconnect prevents unbounded history growth (research pitfall INFRA-04)
  - desc: Use y-partykit onConnect handler pattern instead of extending base class
    rationale: y-partykit exports onConnect function, not YPartyKitServer class
  - desc: Remove CONVEX_SITE_URL from partykit.json define field
    rationale: PartyKit's define field doesn't support env: prefix syntax, will add env vars in Plan 02 when needed for auth
metrics:
  tasks: 2
  commits: 1
  files-created: 3
  files-modified: 2
  duration: 2.9 min
  completed: 2026-02-11T12:43:44Z
---

# Phase 11 Plan 01: PartyKit Infrastructure & Persistence Summary

PartyKit server with Yjs snapshot mode persistence integrated into monorepo development workflow.

## Execution Report

### Tasks Completed

| Task | Name                                                      | Status   | Commit  |
| ---- | --------------------------------------------------------- | -------- | ------- |
| 1    | Install PartyKit dependencies and configure project       | Complete | 3494005 |
| 2    | Create PartyKit Yjs server with snapshot mode persistence | Complete | 3494005 |

### What Was Built

**PartyKit Infrastructure**
- PartyKit dev server runs on port 1999 alongside Vite (5173) and Convex
- Yjs document sync with automatic snapshot mode persistence
- Room-based isolation: each document/diagram gets its own Durable Object
- Local dev persistence via `.partykit/state` directory (gitignored)

**Development Workflow**
- `npm run dev` starts all three services in parallel: Vite + Convex + PartyKit
- `npm run dev:partykit` starts PartyKit server independently
- `npm run deploy` includes PartyKit deployment step
- `npm run deploy:partykit` deploys PartyKit server to production

**Configuration**
- `partykit.json` defines project name "ripple-collaboration", port 1999, and local persistence
- `partykit/tsconfig.json` provides TypeScript config for server code (ES2022, bundler resolution)
- Server implements `Party.Server` interface with `onConnect` handler

### Implementation Details

**Server Architecture** (partykit/server.ts)
```typescript
import type * as Party from "partykit/server";
import { onConnect } from "y-partykit";

export default class CollaborationServer implements Party.Server {
  constructor(readonly room: Party.Room) {}

  onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    return onConnect(conn, this.room, {
      persist: { mode: "snapshot" },
    });
  }
}
```

**Key Features**
- **Snapshot mode persistence**: Full document history maintained while clients are connected, compressed to snapshot when last client disconnects
- **Durable Objects storage**: Room state persists across server restarts automatically in production
- **Room isolation**: Each room ID ("doc-{id}" or "diagram-{id}") gets independent Durable Object instance
- **Zero-config Yjs sync**: y-partykit handles all WebSocket message routing, awareness protocol, and persistence

**Room ID Convention**
- Documents: `doc-{documentId}`
- Diagrams: `diagram-{diagramId}`

### Deviations from Plan

**1. [Rule 1 - Bug] Fixed y-partykit import pattern**
- **Found during:** Task 2 - TypeScript compilation
- **Issue:** Plan referenced `YPartyKitServer` class from "y-partykit/server", but y-partykit exports `onConnect` function from main entry, not a server class
- **Fix:** Changed from class extension pattern to implementing `Party.Server` interface and calling `onConnect` handler
- **Files modified:** partykit/server.ts
- **Commit:** 3494005

**2. [Rule 1 - Bug] Removed invalid define field from partykit.json**
- **Found during:** Task 1 - PartyKit dev server startup
- **Issue:** PartyKit's define field doesn't support "env:CONVEX_SITE_URL" syntax, causing build error: "Invalid define value (must be an entity name or valid JSON syntax)"
- **Fix:** Removed define field from partykit.json; environment variables will be passed via vars field in Plan 02 when auth integration requires them
- **Files modified:** partykit.json
- **Commit:** 3494005

### Verification Results

All verification criteria passed:

- [x] `npm run dev` starts Vite + Convex + PartyKit (3 parallel processes)
- [x] PartyKit dev server accessible at ws://localhost:1999
- [x] `npm ls partykit yjs y-partykit` shows correct versions (0.0.115, 13.6.29, 0.0.33)
- [x] No TypeScript errors in partykit/ directory
- [x] `.partykit/` directory in .gitignore

### Dependencies Installed

| Package    | Version | Type         | Purpose                              |
| ---------- | ------- | ------------ | ------------------------------------ |
| partykit   | 0.0.115 | devDependency | PartyKit CLI and runtime             |
| yjs        | 13.6.29 | dependency   | Core CRDT library for collaboration  |
| y-partykit | 0.0.33  | dependency   | Yjs integration for PartyKit runtime |

### Next Steps

Plan 02 will add:
- Auth integration via `onBeforeConnect` static handler
- Convex token validation using CONVEX_SITE_URL environment variable
- Per-room authorization checks (workspace member validation)

## Self-Check: PASSED

**Created files:**
- [x] partykit.json exists
- [x] partykit/server.ts exists
- [x] partykit/tsconfig.json exists

**Commits:**
- [x] 3494005 exists in git log

**Functionality:**
- [x] PartyKit dev server starts on port 1999
- [x] No TypeScript errors
- [x] All three services start in parallel via `npm run dev`
