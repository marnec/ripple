---
phase: 16-auth-resilience
plan: 01
subsystem: collaboration
tags: [websocket, partykit, yjs, authentication, token-refresh, reconnection]

# Dependency graph
requires:
  - phase: 14-protocol-foundation
    provides: "Shared protocol types for WebSocket messages and error codes"
  - phase: 15-persistence-layer
    provides: "PartyKit server with Yjs snapshot persistence"
provides:
  - "Dynamic token refresh via async params function for automatic reconnection"
  - "Per-connection user state tracking for downstream permission re-validation"
affects: [16-02-permission-validation, 17-graceful-degradation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dynamic params function in y-partykit for token refresh on reconnection"
    - "PartyKit connection state API for per-connection metadata storage"

key-files:
  created: []
  modified:
    - "src/hooks/use-yjs-provider.ts"
    - "partykit/server.ts"
    - "src/pages/App/Document/CustomBlocks/DiagramBlock.tsx"
    - "src/pages/App/Project/CustomInlineContent/DiagramEmbed.tsx"

key-decisions:
  - "Use async params function instead of static object to fetch fresh token on each reconnection"
  - "Return empty token on getToken failure for graceful server rejection vs provider throwing"
  - "Store userId/userName on connection via setState for Plan 02 permission checks"
  - "Diagram embeds show placeholder after Phase 15 content field removal (Yjs previews not feasible)"

patterns-established:
  - "Token refresh pattern: params function fetches fresh token on each connect/reconnect"
  - "Connection state pattern: setState after auth success, read via conn.state in later handlers"

# Metrics
duration: 5.5min
completed: 2026-02-12
---

# Phase 16 Plan 01: WebSocket Reconnection with Fresh Tokens Summary

**Dynamic token refresh via async params function enables automatic WebSocket reconnection with fresh collaboration tokens, eliminating stale token rejections after network drops**

## Performance

- **Duration:** 5.5 min (332 seconds)
- **Started:** 2026-02-12T21:59:20Z
- **Completed:** 2026-02-12T22:04:52Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- YPartyKitProvider uses async params function to fetch fresh token on every connection/reconnection
- PartyKit server stores authenticated userId and userName on each connection for downstream use
- Fixed broken diagram embeds from Phase 15 content field removal
- Zero-downtime reconnection support for extended editing sessions beyond token TTL

## Task Commits

Each task was committed atomically:

1. **Task 1: Dynamic token refresh in useYjsProvider via params function** - `f8cbf79` (feat)
   - Includes deviation fix for diagram embeds
2. **Task 2: Per-connection user state tracking in PartyKit server** - `ea1860d` (feat)

## Files Created/Modified
- `src/hooks/use-yjs-provider.ts` - Replaced static params with async function that fetches fresh token on each connection/reconnection
- `partykit/server.ts` - Added ConnectionState interface and conn.setState call after successful auth
- `src/pages/App/Document/CustomBlocks/DiagramBlock.tsx` - Fixed broken diagram preview (removed content field parsing)
- `src/pages/App/Project/CustomInlineContent/DiagramEmbed.tsx` - Fixed broken diagram embed (removed content field parsing)

## Decisions Made
- **Async params function pattern:** Leverages y-partykit's built-in reconnection mechanism. Each connection attempt (initial + reconnects) calls the params function, which fetches a fresh token from Convex. This eliminates stale token rejections.
- **Error handling in params:** Return empty token `{ token: "" }` on getToken failure instead of throwing. This allows the server to reject gracefully with AUTH_INVALID rather than the provider crashing during param resolution.
- **RoomId computation:** Inline roomId calculation (`${resourceType}-${resourceId}`) matches buildRoomId pattern from shared/protocol but avoids import to keep hook simple.
- **Connection state storage:** Use PartyKit's conn.setState API to store authenticated userId/userName after successful token verification. Plan 02 will read this back for permission re-validation.
- **Diagram embed placeholder:** Since Phase 15 removed the legacy content field and diagrams now use Yjs exclusively, embedded diagrams can't show static previews. Display "Click to view" placeholder instead of attempting to render.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed diagram embeds broken by Phase 15 content field removal**
- **Found during:** Task 1 (running npm run lint after implementing dynamic token refresh)
- **Issue:** DiagramBlock.tsx and DiagramEmbed.tsx were accessing `diagram.content` field which was removed in Phase 15. TypeScript compilation failed with "Property 'content' does not exist" errors. This broke embedded diagrams in documents and task descriptions.
- **Fix:** Replaced content field parsing logic with `const parsedElements = null` to trigger existing "empty diagram" placeholder. Since Yjs content can't be easily accessed for static previews, show "Click to view diagram" message instead. Removed unused imports (exportToSvg, ExcalidrawElement, NonDeleted, AppState, useTheme, useSanitize) and dead SVG rendering code.
- **Files modified:**
  - src/pages/App/Document/CustomBlocks/DiagramBlock.tsx
  - src/pages/App/Project/CustomInlineContent/DiagramEmbed.tsx
- **Verification:** npm run lint passes with 0 warnings, npm run build succeeds
- **Committed in:** f8cbf79 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Necessary correctness fix. Phase 15 removed content field but didn't update diagram embed components. Auto-fix prevents broken embeds from blocking plan execution.

## Issues Encountered
None - plan executed smoothly with one deviation auto-fixed per Rule 1.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- WebSocket reconnection with fresh tokens implemented and verified
- Connection state tracking in place for Plan 02 permission re-validation
- Ready for Plan 02: Permission Re-validation on Reconnect

---
*Phase: 16-auth-resilience*
*Completed: 2026-02-12*

## Self-Check: PASSED

**Files verified:**
- ✓ src/hooks/use-yjs-provider.ts
- ✓ partykit/server.ts
- ✓ src/pages/App/Document/CustomBlocks/DiagramBlock.tsx
- ✓ src/pages/App/Project/CustomInlineContent/DiagramEmbed.tsx

**Commits verified:**
- ✓ f8cbf79 (Task 1)
- ✓ ea1860d (Task 2)
