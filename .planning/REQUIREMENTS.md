# Requirements: Ripple v0.10 Multiplayer Cursors & Collaboration

**Defined:** 2026-02-10
**Core Value:** Seamless integration between all workspace features — users, documents, diagrams, and tasks can reference and embed each other, creating a connected workspace rather than isolated tools.

## v0.10 Requirements

### WebSocket Infrastructure

- [ ] **INFRA-01**: PartyKit server deployed on Cloudflare with room-per-document isolation
- [ ] **INFRA-02**: PartyKit authentication integrated with Convex user identity
- [ ] **INFRA-03**: Yjs document state persisted via PartyKit snapshot mode (durable across restarts)
- [ ] **INFRA-04**: Snapshot compaction prevents unbounded Yjs update history growth

### Document Cursors

- [ ] **DCUR-01**: User can see other users' cursor positions in real-time in BlockNote documents
- [ ] **DCUR-02**: User can see other users' text selection ranges highlighted with user color
- [ ] **DCUR-03**: Each user's cursor displays a colored label with their display name
- [ ] **DCUR-04**: Cursor updates feel instantaneous (sub-100ms latency target)

### Document Collaboration Migration

- [ ] **DCOL-01**: BlockNote documents sync content via Yjs CRDTs (replacing ProseMirror Sync)
- [ ] **DCOL-02**: Existing documents migrated from ProseMirror JSON to Yjs format
- [ ] **DCOL-03**: Custom BlockNote inline content types (diagrams, documents, users, projects) work with Yjs sync
- [ ] **DCOL-04**: Document content persists in Yjs binary format with Convex backup

### Diagram Multiplayer

- [ ] **DIAG-01**: User can see other users' pointer positions in real-time in Excalidraw diagrams
- [ ] **DIAG-02**: Each user's pointer displays a colored label with their display name
- [ ] **DIAG-03**: Excalidraw element changes sync in real-time between users
- [ ] **DIAG-04**: Existing diagrams remain compatible with new multiplayer infrastructure

### User Awareness

- [ ] **AWARE-01**: User can see a list of active users currently in the same document
- [ ] **AWARE-02**: User can see a list of active users currently in the same diagram
- [ ] **AWARE-03**: User colors are consistent per user across all documents and diagrams

## Future Requirements

### v0.11+

- **DCUR-05**: Smooth cursor interpolation between position updates (perfect-cursors library)
- **DCUR-06**: Idle cursor dimming after 30 seconds of inactivity
- **DIAG-05**: Viewport following — click user avatar to jump to their viewport
- **DIAG-06**: Selection highlights showing what other users have selected
- **DCOL-05**: Offline editing support with automatic sync on reconnect
- **AWARE-04**: Cross-feature presence — see who's editing which document from workspace sidebar

## Out of Scope

| Feature | Reason |
|---------|--------|
| Threaded/versioned document history | Significant storage and UI complexity; validate collaboration model first |
| Conflict resolution UI (manual merge) | Yjs CRDTs resolve conflicts automatically; manual merge adds confusion |
| Video cursors / screen sharing in editor | WebRTC + editor integration is separate concern; video calls already exist |
| Real-time chat typing indicators | Different feature category; cursor awareness is for docs/diagrams only |
| Cursor analytics / heatmaps | Needs usage data first; premature optimization |
| Multi-document awareness (see cursors across docs) | Scope to single document/diagram view; workspace-level awareness is v2 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01 | — | Pending |
| INFRA-02 | — | Pending |
| INFRA-03 | — | Pending |
| INFRA-04 | — | Pending |
| DCUR-01 | — | Pending |
| DCUR-02 | — | Pending |
| DCUR-03 | — | Pending |
| DCUR-04 | — | Pending |
| DCOL-01 | — | Pending |
| DCOL-02 | — | Pending |
| DCOL-03 | — | Pending |
| DCOL-04 | — | Pending |
| DIAG-01 | — | Pending |
| DIAG-02 | — | Pending |
| DIAG-03 | — | Pending |
| DIAG-04 | — | Pending |
| AWARE-01 | — | Pending |
| AWARE-02 | — | Pending |
| AWARE-03 | — | Pending |

**Coverage:**
- v0.10 requirements: 19 total
- Mapped to phases: 0
- Unmapped: 19

---
*Requirements defined: 2026-02-10*
*Last updated: 2026-02-10 after initial definition*
