# Pitfalls Research

**Domain:** Multiplayer Cursors and Real-Time Collaboration Infrastructure
**Researched:** 2026-02-10
**Confidence:** HIGH

## Critical Pitfalls

### Pitfall 1: Dual Real-Time System State Divergence

**What goes wrong:**
Convex subscriptions manage document persistence and permissions while PartyKit/Yjs manages ephemeral CRDT state. When both systems track related but separate state (e.g., document content in Convex vs. Yjs CRDT updates), they can diverge during network partitions, race conditions during reconnection, or concurrent writes. Users see different versions of the document, with Convex showing the "database truth" and Yjs showing the "CRDT truth."

**Why it happens:**
Developers assume both systems will stay in sync automatically. Convex updates trigger on database mutations, Yjs updates trigger on CRDT operations. During reconnection, Convex resubscribes to queries while Yjs replays updates—these happen in different orders with different timing. Your current system uses Convex for presence (`useEnhancedPresence`) and Cloudflare RTK for cursors (`useCursorTracking`), which already creates this dual-system pattern.

**How to avoid:**
- **Single source of truth per domain:** Convex owns persistent data (document content, permissions, membership), Yjs/PartyKit owns ephemeral state (cursor positions, selection ranges, awareness). Never duplicate the same state in both systems.
- **One-way sync only:** If you must sync between systems, make it unidirectional. Example: Yjs updates write to Convex on debounce (500ms-2s), but Convex never writes back to Yjs (that would create circular updates).
- **Versioning and timestamps:** Add version numbers to Convex document records. When initializing Yjs from Convex, check version. If Yjs has newer updates than Convex version, wait for persistence to complete before allowing edits.
- **Separate providers cleanly:** Use Convex Presence for "who's here" (user list in FacePile), PartyKit Awareness for "what they're doing" (cursor positions, selections). Your existing `useEnhancedPresence` and `useCursorTracking` already follow this pattern—maintain this separation.

**Warning signs:**
- Users report "my changes disappeared after refresh" (Yjs had updates not yet persisted to Convex)
- Cursor positions flash/jump during reconnection (both systems resyncing in different order)
- Permission errors on edits immediately after joining (Convex hasn't confirmed membership but Yjs already allows edits)
- Different users see different document states after network blip

**Phase to address:**
Phase 1 (Infrastructure Setup) — Define clear boundaries between Convex and Yjs domains before any implementation. Document in architecture file which system owns what.

---

### Pitfall 2: ProseMirror Sync to Yjs Migration Data Loss

**What goes wrong:**
Your BlockNote documents currently use `@convex-dev/prosemirror-sync` which stores ProseMirror steps in Convex. Migrating to Yjs means converting from step-based operational transformation (OT) to CRDT-based sync. The data models are incompatible: ProseMirror steps are sequential transformations, Yjs updates are commutative operations. Naive conversion loses formatting, custom blocks (DiagramBlock, User mentions), or corrupts document structure.

**Why it happens:**
Developers assume "both are ProseMirror, so data should be compatible." But `prosemirror-sync` serializes steps (transform operations), while `y-prosemirror` embeds ProseMirror into a Yjs shared type. Even though BlockNote uses ProseMirror under the hood, switching collaboration providers means re-storing all document content. The schema (custom blocks: `diagram`, inline content: `mention`) must be rebuilt in the Yjs provider's initialization.

**How to avoid:**
- **Export to canonical format first:** Convert all documents to BlockNote's JSON representation (`editor.document` → JSON), store in Convex as transition format.
- **Dual-write during migration:** For a transition period, write to both `prosemirror-sync` AND initialize Yjs docs from the same source. Keep `prosemirror-sync` read-only as fallback.
- **Schema preservation:** Initialize Yjs provider with identical BlockNote schema (your custom `DiagramBlock` and `User` inline content). Test that schema survives round-trip: Yjs → ProseMirror → Yjs.
- **Migration script per document:** Don't migrate all at once. Create Convex mutation that reads ProseMirror doc, converts to BlockNote JSON, initializes Yjs doc from JSON, saves Yjs snapshot to new table. Run per document with rollback capability.
- **Keep old data:** Never delete `prosemirror-sync` data until months after migration. Store migration timestamp in `documents` table.

**Warning signs:**
- Custom blocks (Excalidraw diagrams) render as plain text after migration
- @mentions show as `[@Unknown User]` or break entirely
- Formatting (bold, italic, lists) gets stripped during conversion
- Documents with complex nesting (lists in lists) corrupt
- Undo/redo breaks after migration (new Yjs history vs. old step history)

**Phase to address:**
Phase 2 (Migration & Compatibility) — After PartyKit infrastructure exists but before enabling for users. Include rollback plan.

---

### Pitfall 3: Cursor Broadcasting Rate Limit Overload

**What goes wrong:**
Your current system throttles cursor broadcasts to 200ms (`THROTTLE_MS = 200` in `use-cursor-tracking.ts`), which sends 5 updates/second per user. With 20 simultaneous editors, that's 100 cursor updates/second. Cloudflare RTK has a 5 events/second limit (per your PROJECT.md), causing dropped cursor updates, phantom cursors that don't move, or connection throttling. PartyKit without Hibernation supports only 100 connections per room—20 users = 40 connections (cursors + presence), hitting limits in larger documents.

**Why it happens:**
Cursor position broadcasts naively on `mousemove` events, which fire 100+ times per second. Even with throttling, multiplying by number of users creates traffic spikes. The problem compounds when users make rapid selections (click-drag) which generates both cursor AND selection updates. Your current RTK implementation hit this exact problem (5 events/s too slow), and switching to PartyKit without Hibernation doesn't solve it—just moves the bottleneck from rate limits to memory limits.

**How to avoid:**
- **Server-side batching:** PartyKit server collects cursor updates for 50ms, then broadcasts once as batch: `{ cursors: [{ userId, x, y }, ...] }`. Reduces broadcasts from N per user to 1 per batch interval.
- **Pause-based updates:** Only broadcast cursor after 100ms pause (existing approach), not on every throttle tick. When cursor actively moving, skip broadcasts—only send when cursor stops. Your current implementation already attempts this but still sends every 200ms if mouse keeps moving.
- **Viewport culling:** Don't broadcast cursor positions outside viewport. On server, track which users see which regions (viewport coordinates), only broadcast to relevant users.
- **Separate cursor from awareness:** Cursor positions go through high-frequency PartyKit room, document content goes through Yjs provider. Don't mix ephemeral (cursor) and durable (document) in same WebSocket stream.
- **Enable PartyKit Hibernation:** Once y-partykit supports it (currently doesn't), Hibernation scales to 32,000 connections vs. 100. Until then, separate cursor-only rooms (no Yjs) can use Hibernation, Yjs rooms stay non-hibernated.

**Warning signs:**
- Cursors "lag" or freeze for seconds then jump to new position
- Console errors: "Broadcast rate limit exceeded" or "Too many requests"
- Some users' cursors never appear (connection rejected due to room limit)
- Cursor positions work with 5 users but break at 15+ users
- Network tab shows WebSocket sending messages but server not acknowledging

**Phase to address:**
Phase 1 (Infrastructure Setup) — Design server-side batching into PartyKit server from start. Don't replicate current RTK throttle pattern.

---

### Pitfall 4: Excalidraw Self-Hosted Collaboration URL Hardcoding

**What goes wrong:**
The official Excalidraw npm package hardcodes collaboration URL to `https://oss-collab.excalidraw.com` at build time via `VITE_APP_WS_SERVER_URL`. Overriding this with environment variables at runtime fails because the URL is baked into compiled JavaScript. Self-hosted collaboration requires patching build assets or forking Excalidraw, both of which break on library updates. Your `DiagramBlock` embeds Excalidraw but doesn't use collaboration—adding it later hits this wall.

**Why it happens:**
Excalidraw's Vite build inlines environment variables at compile time, not runtime. The library assumes users either use Excalidraw's hosted collab service or self-host the entire app (not embed the component). Your use case (embed Excalidraw component + self-hosted collab) isn't the primary supported pattern.

**How to avoid:**
- **Separate diagram provider:** Don't reuse BlockNote's Yjs provider for Excalidraw. Create dedicated PartyKit room for each diagram. Excalidraw has its own reconciliation logic (`reconcileElements`) that conflicts with Yjs CRDT merging.
- **Fork @excalidraw/excalidraw:** Create `@ripple/excalidraw` fork that accepts `collaborationUrl` prop at runtime. Pin to specific version, document upgrade process. Alternative: use official Excalidraw embed in iframe with postMessage communication.
- **Stateless collaboration:** Store Excalidraw state (`elements`, `appState`) in Convex diagrams table. On change (debounced 100ms like your current `ExcalidrawEditor`), save to Convex. Broadcast "diagram updated" event via PartyKit, other clients fetch from Convex. Trades real-time smoothness for simpler infrastructure.
- **Manual reconciliation:** Keep current approach (Convex + `reconcileElements` + debounced save). Broadcast cursor positions only via PartyKit Awareness, not diagram content. This avoids Excalidraw collab complexity entirely.

**Warning signs:**
- Excalidraw diagrams don't show other users' cursors despite collaboration enabled
- Environment variable changes don't affect collaboration URL
- Console errors: "Failed to connect to wss://oss-collab.excalidraw.com" (wrong URL)
- Diagram collaboration works in Excalidraw demo but not in your embedded component
- npm audit shows vulnerabilities in forked Excalidraw (fork maintenance burden)

**Phase to address:**
Phase 3 (Excalidraw Integration) — Decide collaboration strategy before implementation. If using Excalidraw native collab, address URL issue first. If stateless, skip Excalidraw collab entirely.

---

### Pitfall 5: Yjs Persistence Without Snapshot Compaction

**What goes wrong:**
Yjs stores all updates as append-only operations. A document edited 10,000 times has 10,000 update entries. Loading requires replaying all updates sequentially, causing 5+ second load times for heavily-edited documents. Storing raw updates in Convex creates massive storage bloat (100KB document → 10MB updates history). Without snapshot compaction, old documents become unusable.

**Why it happens:**
Yjs CRDTs are designed for append-only updates to guarantee convergence. Developers store updates directly in database without merging, assuming "updates are small." But updates accumulate—a cursor position change is an update, every keystroke is an update. For long-lived documents (active for months), this grows unbounded.

**How to avoid:**
- **Periodic snapshot creation:** Every 100 updates or every hour (whichever first), merge all updates into single snapshot. Store snapshot in Convex `diagrams.content` or new `documentSnapshots` table. Keep recent updates (last 50) for fine-grained history, delete older ones.
- **PartyKit-side compaction:** PartyKit server tracks update count. At 100 updates, call `Y.encodeStateAsUpdate(doc)` to create compact snapshot, save to Convex, broadcast "snapshot created" event, clear old updates from room memory.
- **Lazy loading with base snapshot:** On document open, load latest snapshot from Convex, apply only recent updates from PartyKit. Don't replay full history unless user requests version history.
- **Separate metadata updates:** Awareness updates (cursor, selection) should never persist. Only document content updates persist. Use separate Yjs providers: permanent doc provider (persists), ephemeral awareness provider (doesn't persist).
- **Migration path:** Current Excalidraw implementation already debounces saves (100ms) and stores full state, not updates. Maintain this pattern—store snapshots, not update history.

**Warning signs:**
- Document load time increases over weeks (1s → 5s → 20s)
- Database storage grows much faster than expected (100 documents = 1GB+)
- Convex function timeouts when loading old documents (too many updates to replay)
- Browser tab crashes on opening heavily-edited document (out of memory replaying updates)
- Yjs provider initialization takes >2 seconds (should be <200ms)

**Phase to address:**
Phase 1 (Infrastructure Setup) — Design snapshot strategy into PartyKit persistence layer. Don't defer to "optimize later."

---

### Pitfall 6: Offline Edits Conflict with Convex Reactivity

**What goes wrong:**
User goes offline, makes edits in Yjs (which works offline), then reconnects. Yjs syncs updates, but Convex subscription re-runs queries and overwrites Yjs state with stale data from database. User's offline edits disappear or create duplicates. Alternatively, Yjs syncs updates but Convex permissions check fails (user's session expired during offline period), updates rejected.

**Why it happens:**
Yjs CRDTs allow offline editing by design—changes merge automatically on reconnect. Convex subscriptions are stateless—they refetch on reconnect, unaware of Yjs offline changes. When both systems reconnect, they race: does Yjs persist updates to Convex first, or does Convex subscription deliver stale data first?

**How to avoid:**
- **Yjs-first initialization:** On document load, initialize from Yjs provider, not Convex query. Use Convex only for initial load if Yjs has no local state. Never overwrite Yjs state from Convex after initialization.
- **Optimistic Convex mutations:** When Yjs persists to Convex, use optimistic updates. The Convex mutation shouldn't trigger re-render—UI already updated from Yjs.
- **Auth token refresh:** Before syncing offline updates, refresh Convex auth token. Check permissions still valid. If user lost access during offline period, show modal: "You lost edit access, offline changes not saved."
- **Conflict detection:** Add `lastEditTimestamp` and `lastEditUserId` to Convex documents table. When Yjs syncs offline updates, compare timestamps. If Convex timestamp is newer than user's last sync, show conflict warning.
- **Disable offline for MVP:** Yjs/PartyKit support offline, but your use case is real-time collaboration (users online together). Simply show "You're offline, edits disabled" banner when WebSocket disconnects. Enable offline in later phase after conflict resolution proven.

**Warning signs:**
- User reports "my changes disappeared after WiFi came back"
- Document reverts to earlier version after reconnection
- Duplicate content appears (offline edits + server edits both applied)
- Permission error after reconnection: "You can't edit this document" (auth expired offline)
- Undo/redo stack corrupted after offline → online transition

**Phase to address:**
Phase 4 (Offline & Reconnection) — After core collaboration works online-only. Add offline support as enhancement, not initial feature.

---

### Pitfall 7: PartyKit Cold Start Latency for Cursor Awareness

**What goes wrong:**
User opens document, PartyKit server hibernated (cold). Server takes 2-5 seconds to start, initialize Yjs doc from Convex, and establish WebSocket. During this time, user sees no cursors, presence list empty, feels like "collaboration is broken." User starts editing before PartyKit connects, creates 0-5 second window of unsynchronized edits.

**Why it happens:**
Cloudflare Workers (PartyKit backend) hibernate after inactivity. First user to room triggers cold start. Without Hibernation API, PartyKit room starts from scratch—new process, new memory, must load Yjs state from storage. Your current RTK implementation doesn't have this issue (always-on service), but PartyKit does.

**How to avoid:**
- **Optimistic presence:** Show "Loading collaboration..." state immediately. Display user's own cursor/presence even before PartyKit connects. Gives immediate feedback, prevents "nothing's happening" perception.
- **Prefetch on navigation:** When user clicks document in sidebar, start PartyKit connection before rendering DocumentEditor. By the time editor loads, WebSocket already connected.
- **Local-first editing:** Allow editing immediately, don't block on PartyKit connection. If connection takes >3 seconds, show warning but keep editor functional. Yjs handles late synchronization.
- **Connection state UI:** Your `use-cursor-tracking` already returns `isConnected`. Display connection indicator: green dot (connected), yellow (connecting), red (disconnected). Users understand why cursors missing.
- **Separate providers by priority:** Core document editing should work without PartyKit (use Convex optimistic updates). PartyKit adds real-time cursors/presence as enhancement, not requirement.

**Warning signs:**
- Users report "I don't see other people until 5 seconds after opening document"
- Cursor positions suddenly appear all at once (backlog of updates after cold start)
- First user to document always has degraded experience, subsequent users fine
- Logs show PartyKit server restart on every document open (no connection reuse)
- Metrics: p50 connection time <500ms, p95 connection time >3s (cold start outliers)

**Phase to address:**
Phase 1 (Infrastructure Setup) — Design UI to handle cold start delays. Don't assume instant connection.

---

### Pitfall 8: Memory Leaks from Undestroyed Yjs Documents

**What goes wrong:**
User navigates between documents rapidly. Each document creates Yjs `Y.Doc` instance with providers (PartyKit WebSocket, Awareness). React cleanup (`useEffect` return) disconnects providers but doesn't call `doc.destroy()`. Yjs docs accumulate in memory, each holding full document state. After visiting 50 documents, browser tab uses 2GB RAM and crashes.

**Why it happens:**
Yjs providers (`y-partykit`, `y-websocket`) handle WebSocket cleanup in `provider.destroy()`, but the underlying `Y.Doc` persists in memory unless explicitly destroyed. Developers assume garbage collection happens automatically. BlockNote's `useBlockNoteSync` may not expose Yjs doc lifecycle hooks, requiring manual cleanup in wrapper component.

**How to avoid:**
- **Call doc.destroy() in cleanup:** In your DocumentEditor unmount (useEffect return), call `yjsDoc.destroy()` after `provider.destroy()`. Verify Yjs doc reference nulled out.
- **Track active docs:** Global map of `documentId → Y.Doc`. On mount, check if doc exists, reuse. On unmount, decrement reference count. When count reaches 0, destroy doc. Prevents duplicate docs for same document.
- **Monitor memory:** Add `performance.memory.usedJSHeapSize` logging in dev mode. Alert if memory grows >500MB. Use Chrome DevTools heap snapshots to verify Yjs docs cleaned up.
- **Provider lifecycle testing:** Write test: mount document, unmount, check `Y.Doc` destroyed. Use `doc.on('destroy', callback)` to verify destroy called.
- **React Strict Mode testing:** StrictMode mounts/unmounts twice. If cleanup broken, you'll create 2 docs per visit. Test in StrictMode to catch lifecycle bugs early.

**Warning signs:**
- Browser memory usage grows continuously as user navigates documents
- Browser tab crashes after 30-60 minutes of active use
- DevTools heap snapshot shows dozens of `Y.Doc` instances for single document
- Console warnings: "WebSocket still connected after unmount"
- Performance degrades over time (smooth → laggy) without page refresh

**Phase to address:**
Phase 2 (Migration & Compatibility) — After Yjs integration, before beta. Memory leaks block production readiness.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Store Yjs updates without compaction | Simple implementation, no snapshot logic | Unbounded storage growth, slow document loads | Never—implement from start |
| Reuse single PartyKit room for cursors + docs | One WebSocket connection | Mixed ephemeral/durable state, hard to scale | Never—separate from start |
| No offline support | Simpler conflict resolution | Users expect offline in 2026 | MVP only—add by v1.0 |
| Skip Yjs → Convex persistence | Yjs works standalone | Data loss on PartyKit failure, no backup | Never—persist Yjs state |
| Use Excalidraw hosted collab service | No self-host complexity | Vendor lock-in, data privacy issues | Acceptable for prototype only |
| Broadcast all cursor movements | Smooth cursors at small scale | Rate limits, performance issues at scale | Small teams (<5 users) only |
| Client-side only Yjs (no server persistence) | Fast setup | Loss of single source of truth | Demos only, never production |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| PartyKit + Yjs | Assuming y-partykit supports Hibernation | y-partykit currently doesn't support Hibernation—stay under 100 connections or use separate cursor-only rooms with Hibernation |
| Convex + Yjs | Storing Yjs updates in Convex without schema validation | Validate Yjs update structure before persisting, wrap in try-catch for corrupted updates |
| BlockNote + Yjs | Assuming `@convex-dev/prosemirror-sync` is compatible with `y-prosemirror` | Complete data migration required—different persistence models (steps vs. CRDTs) |
| Excalidraw + PartyKit | Using Excalidraw's built-in collab with custom WebSocket URL | Hardcoded at build time—fork library or use stateless approach (Convex + manual reconcile) |
| React + Yjs providers | Creating new `Y.Doc()` on every render | Memoize with `useMemo` or global singleton map keyed by documentId |
| PartyKit + Convex Auth | Passing Convex JWT to PartyKit expecting validation | PartyKit doesn't know Convex auth—use separate auth token from Convex action or validate Convex JWT in PartyKit onConnect |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Broadcasting every mousemove | Smooth local cursors, laggy remote cursors | Server-side batching (50ms), only broadcast after 100ms pause | 10+ simultaneous users |
| Loading full Yjs update history | Instant for new docs, slow for old docs | Snapshot compaction every 100 updates | Documents >1 week old or >1000 edits |
| Separate WebSocket per document element | Works with 1 diagram, browser hangs with 20 | Multiplex: one WebSocket per document, subdocuments for diagrams | 5+ embedded diagrams in single doc |
| Client-side Yjs reconciliation in render loop | Works at 60fps with small docs, freezes with large docs | Move reconciliation to Web Worker, debounce setState | Documents >10,000 characters |
| Storing awareness in Yjs doc | Immediate updates | Massive update history from ephemeral state | Any production use—awareness should never persist |
| No index on Convex cursorSessions.active | Fast with 10 rooms, slow with 1000 rooms | Already have `by_document_active` index—ensure queries use it | 100+ concurrent documents |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| PartyKit room IDs are document IDs (public) | Unauthorized users guess room IDs, join sessions | Generate random room ID per session in Convex, check permissions before returning room ID |
| No permission check in PartyKit onConnect | Anyone with room ID can join | Validate auth token in onConnect, fetch document from Convex, check user has permission |
| Broadcasting user's email in cursor awareness | Privacy leak | Only broadcast userId and display name, fetch email server-side if needed |
| Persisting Yjs updates without size limits | DOS attack via huge updates | Limit update size to 1MB, reject larger updates |
| Storing Convex auth token in Yjs awareness | Token exposed to all room participants | Use separate short-lived PartyKit token from Convex action |
| No rate limiting on cursor broadcasts | Malicious client spams updates, DOS other users | Server-side rate limit: 10 updates/second per user, disconnect violators |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No loading state for PartyKit connection | Users think collaboration broken (blank FacePile) | Show "Connecting..." with spinner, display own presence immediately |
| Cursor jumps on reconnection | Disorienting, feels buggy | Smoothly animate cursor from last position to new position over 200ms |
| All cursors same color | Can't distinguish who's who | Hash userId to color (you already do this in CursorOverlay) |
| Cursor disappears when user stops moving mouse | Looks like user left | Show cursor for 5 seconds after last movement (you have STALE_TIMEOUT_MS = 5000) |
| No indication of offline mode | Users make edits that may not save | Large banner: "You're offline. Changes will sync when reconnected." |
| Presence list shows all workspace members | Confusing who's actually in document | Only show users in current document (you already do this with `useEnhancedPresence(documentId)`) |
| Cursor positions as absolute pixels | Breaks on window resize | Store as percentage of container (you already do this: `x: number // % of container width`) |
| No "user is typing" indicator in Excalidraw | Unclear who's editing diagram | Broadcast drawing state via awareness, show colored outline on selected elements |

## "Looks Done But Isn't" Checklist

- [ ] **Cursor awareness:** Often missing cleanup on unmount — verify no memory leaks after navigating 50 documents
- [ ] **Yjs persistence:** Often missing snapshot compaction — test document with 10,000 edits loads in <1 second
- [ ] **PartyKit auth:** Often missing permission checks in onConnect — verify unauthorized user gets rejected
- [ ] **Offline sync:** Often missing conflict resolution — test two users edit offline, reconnect simultaneously
- [ ] **Excalidraw collab:** Often missing custom collaboration URL config — verify self-hosted collab connects, not oss-collab.excalidraw.com
- [ ] **Provider cleanup:** Often missing `provider.destroy()` + `doc.destroy()` — check heap snapshot after unmount shows no lingering docs
- [ ] **Reconnection UX:** Often missing "reconnecting..." state — disconnect WiFi, verify user sees status indicator
- [ ] **Rate limiting:** Often missing server-side throttle — spawn 20 clients moving cursors rapidly, verify no rate limit errors
- [ ] **Cold start handling:** Often missing optimistic UI — measure p95 connection time, verify <3 seconds or show loading state
- [ ] **Migration rollback:** Often missing undo path — verify can revert document from Yjs back to ProseMirror Sync

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Dual system state divergence | HIGH | Add version reconciliation: Convex timestamp vs. Yjs clock, manual merge UI for conflicts |
| ProseMirror → Yjs migration data loss | HIGH | Restore from Convex backup, re-run migration with fixed schema, test round-trip conversion first |
| Cursor rate limit overload | MEDIUM | Implement server-side batching, reduce broadcast frequency to 500ms, add viewport culling |
| Excalidraw collab URL hardcoded | MEDIUM | Fork library with runtime config, or pivot to stateless approach (Convex + manual reconcile) |
| Yjs persistence without compaction | MEDIUM | Run compaction job on all documents, delete old updates, add auto-compaction to PartyKit server |
| Offline edits conflict | LOW | Show conflict resolution UI, let user pick version, add "last edit wins" logic with timestamp |
| PartyKit cold start latency | LOW | Add prefetch on document hover, show loading state, optimize Yjs snapshot loading |
| Memory leaks from undestroyed docs | LOW | Add global cleanup, force browser refresh for affected users, fix lifecycle in next deploy |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Dual real-time system state divergence | Phase 1: Infrastructure | Chaos test: disconnect PartyKit, mutate Convex, reconnect—verify convergence |
| ProseMirror Sync to Yjs migration | Phase 2: Migration | Run migration on copy of production DB, round-trip test all documents |
| Cursor broadcasting rate limit | Phase 1: Infrastructure | Load test: 20 users × 5 updates/sec = 100/sec, verify no dropped cursors |
| Excalidraw collab URL hardcoding | Phase 3: Excalidraw | Verify WebSocket connects to PartyKit, not oss-collab.excalidraw.com |
| Yjs persistence without compaction | Phase 1: Infrastructure | Create doc with 1000 edits, verify snapshot created, load time <500ms |
| Offline edits conflict | Phase 4: Offline | Disconnect two clients, make conflicting edits, reconnect, verify merge |
| PartyKit cold start latency | Phase 1: Infrastructure | Measure p95 connection time in production, verify <3s or loading state shown |
| Memory leaks from undestroyed docs | Phase 2: Integration | Visit 50 documents, check heap size <500MB, verify no lingering Y.Doc |

## Sources

**Yjs and CRDTs:**
- [Yjs GitHub Repository](https://github.com/yjs/yjs)
- [Yjs Documentation](https://docs.yjs.dev/)
- [Awareness & Presence | Yjs Docs](https://docs.yjs.dev/getting-started/adding-awareness)
- [Subdocuments | Yjs Docs](https://docs.yjs.dev/api/subdocuments)
- [How to clear doc.store & memory leak - Yjs Community](https://discuss.yjs.dev/t/how-to-clear-doc-store-memory-leak/2276)
- [Postgres And Yjs CRDT Collaborative Text Editing, Using PowerSync](https://www.powersync.com/blog/postgres-and-yjs-crdt-collaborative-text-editing-using-powersync)

**PartyKit:**
- [Scaling PartyKit servers with Hibernation | PartyKit Docs](https://docs.partykit.io/guides/scaling-partykit-servers-with-hibernation/)
- [Y-PartyKit (Yjs API) | PartyKit Docs](https://docs.partykit.io/reference/y-partykit-api/)
- [PartySocket (Client API) | PartyKit Docs](https://docs.partykit.io/reference/partysocket-api/)
- [Only 100 web socket connections per room on 128MB of memory? · Issue #920](https://github.com/partykit/partykit/issues/920)
- [Partykit gets into occasional infinite loops on connection disconnect · Issue #544](https://github.com/partykit/partykit/issues/544)

**BlockNote and ProseMirror:**
- [BlockNote - Real-time Collaboration](https://www.blocknotejs.org/docs/features/collaboration)
- [FOSDEM 2026 - BlockNote, Prosemirror and Yjs 14](https://fosdem.org/2026/schedule/event/8VKQXR-blocknote-yjs-prosemirror/)
- [GitHub - get-convex/prosemirror-sync](https://github.com/get-convex/prosemirror-sync)
- [ProseMirror | Yjs Docs](https://docs.yjs.dev/ecosystem/editor-bindings/prosemirror)

**Excalidraw:**
- [Collaboration mode - Self-hosting vs Collab · Discussion #3879](https://github.com/excalidraw/excalidraw/discussions/3879)
- [Excalidraw blog | Building Excalidraw's P2P Collaboration Feature](https://plus.excalidraw.com/blog/building-excalidraw-p2p-collaboration-feature)
- [self-hosting live collaboration question · Issue #8195](https://github.com/excalidraw/excalidraw/issues/8195)

**WebSocket and Real-Time Patterns:**
- [How to Handle WebSocket Reconnection Logic](https://oneuptime.com/blog/post/2026-01-24-websocket-reconnection-logic/view)
- [Multiuser whiteboard cursor position update overloads server · Issue #11169](https://github.com/bigbluebutton/bigbluebutton/issues/11169)
- [Implementing cursor sharing with Daily's video call API](https://www.daily.co/blog/implementing-cursor-sharing-with-dailys-video-call-api/)
- [WebRTC vs WebSocket: 10 Key Differences in 2026](https://www.designveloper.com/guide/webrtc-vs-websocket/)

**Convex:**
- [Convex Overview | Convex Developer Hub](https://docs.convex.dev/understanding/)
- [A Guide to Real-Time Databases](https://stack.convex.dev/real-time-database)

**Offline and Conflict Resolution:**
- [Multiplayer - React Flow](https://reactflow.dev/learn/advanced-use/multiplayer)
- [Data Synchronization in PWAs: Offline-First Strategies](https://gtcsys.com/comprehensive-faqs-guide-data-synchronization-in-pwas-offline-first-strategies-and-conflict-resolution/)
- [Understanding real-time collaboration with CRDTs | Medium](https://shambhavishandilya.medium.com/understanding-real-time-collaboration-with-crdts-e764eb65024e)

---

*Pitfalls research for: Multiplayer Cursors and Real-Time Collaboration Infrastructure*
*Researched: 2026-02-10*
