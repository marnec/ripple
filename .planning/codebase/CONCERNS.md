# Codebase Concerns

**Analysis Date:** 2026-02-05

## Tech Debt

**Unsafe Type Annotations (auth.ts):**
- Issue: Multiple `any` type casts used for Convex auth exports without proper typing
- Files: `convex/auth.ts` (lines 58-61)
- Impact: Type safety is lost, making it harder to catch bugs during development; IDE autocomplete and refactoring tools won't work properly
- Fix approach: Create proper TypeScript interfaces for the auth object exports; if API doesn't expose proper types, create wrapper types with known structure

**Untyped WebRTC Data (schema.ts):**
- Issue: `candidate` field in signals table uses `v.any()` without validation, allowing any arbitrary data through
- Files: `convex/schema.ts` (line 94), `convex/signaling.ts` (line 12)
- Impact: WebRTC ICE candidates could be invalid or malformed; no server-side validation of RTC protocol compliance
- Fix approach: Define proper validators for RTCIceCandidate structure instead of `v.any()`; validate candidate format on insert

**Untyped Diagram Elements:**
- Issue: Diagram elements cast to `any` when mapping in diagrams.ts
- Files: `convex/diagrams.ts` (line 183)
- Impact: No validation of diagram element structure; could cause rendering errors if malformed data exists in database
- Fix approach: Define proper types for Excalidraw element structure and use type-safe mapping

**Missing Error Recovery in Notification System:**
- Issue: Push notification failures are logged but not retried or escalated
- Files: `convex/pushNotifications.ts` (lines 79-83)
- Impact: Silent failures - users won't be notified if push sends fail; impossible to know scope of delivery failures
- Fix approach: Implement retry logic with exponential backoff for failed notifications; track delivery metrics

**Incomplete Push Notification Filtering:**
- Issue: Comment in code indicates TODO for channel-level notification filtering, currently filters by workspace
- Files: `convex/pushNotifications.ts` (lines 51-52)
- Impact: Users in workspace get notifications from all channels regardless of membership; potential spam and privacy issue
- Fix approach: Implement channel member filtering before sending notifications; check if user is member of channel

## Known Bugs

**Document Access Control Overly Restrictive:**
- Symptoms: `documents.get()` query requires ADMIN role, but other document access queries allow MEMBER
- Files: `convex/documents.ts` (lines 152-154 vs. 147-150)
- Trigger: Non-admin members trying to read document details
- Impact: Inconsistent permission model; members can edit but can't fetch document metadata
- Workaround: Create a separate read-only query that only requires MEMBER role

**Signal Deduplication Logic Fragile:**
- Symptoms: VideoCall component may process duplicate signals or skip signals
- Files: `src/pages/App/GroupVideoCall/GroupVideoCall.tsx` (lines 390, 459, 496)
- Trigger: Signal IDs generated using `sdp?.substring(0, 50)` for offers/answers; SDP variations or truncation could cause collisions
- Impact: WebRTC connections fail to establish if signals are incorrectly deduplicated or duplicated
- Workaround: Clients should refresh the page; ensures clean state
- Fix: Use server-generated signal IDs or message timestamps + peer IDs

**Channel Member Cleanup Missing on Deletion:**
- Symptoms: When deleting a channel, members are removed but when deleting workspace, member cascades may not be clean
- Files: `convex/channels.ts` (lines 146-158 deletes messages and members)
- Issue: No corresponding cleanup when workspace is deleted
- Impact: Orphaned channelMembers records could accumulate
- Fix approach: Add cascade delete logic to workspace removal

## Security Considerations

**VAPID Public Key Exposed in Client Code:**
- Risk: Push notification VAPID public key hardcoded in browser JavaScript
- Files: `src/hooks/use-push-notifications.tsx` (line 17)
- Current mitigation: Key is public by design (VAPID public key is non-secret)
- Recommendation: This is acceptable per Web Push spec; consider documenting that this is intentional

**Missing Rate Limiting on Convex Functions:**
- Risk: No rate limiting on message sending, user invites, or notifications
- Files: All mutation handlers in `convex/*.ts`
- Current mitigation: None
- Recommendations: Implement rate limiting per user/workspace; prevent DoS through high-volume spam
- Impact: Spammers could flood channels or abuse invitation system

**Unvalidated Document Names in Search:**
- Risk: Document name search is full-text without length validation
- Files: `convex/documents.ts` (lines 77-78)
- Current mitigation: None
- Recommendations: Add max length validation for search queries; prevent extremely large search terms from causing performance issues

**Weak Deduplication in WebRTC Signaling:**
- Risk: SDP-based deduplication is weak and could allow replay attacks
- Files: `src/pages/App/GroupVideoCall/GroupVideoCall.tsx` (lines 390, 459, 496)
- Current mitigation: Processed signals stored in Set with SDP substring
- Recommendations: Use server-issued sequence numbers or nonces; include timestamp validation

**Missing CSRF Protection on Public Mutations:**
- Risk: Public mutation endpoints lack CSRF tokens if used via forms
- Files: All `mutation` functions in `convex/`
- Current mitigation: Convex handles CSRF per their framework
- Recommendations: Verify Convex CSRF protections are enabled; document that clients must follow same-origin policy

## Performance Bottlenecks

**N+1 Query Pattern in Channel Members Fetch:**
- Problem: Fetching channel members requires one query per member to get user details
- Files: `convex/channelMembers.ts` (lines 53-60)
- Cause: Promise.all with individual ctx.db.get() calls per member
- Status: RESOLVED - Code uses Promise.all correctly, but could be optimized with batch fetch helpers
- Improvement path: Use `getAll()` helper from convex-helpers instead of manual Promise.all

**Large Video Call Component (761 lines):**
- Problem: Single component manages WebRTC state, presence, signaling, and rendering
- Files: `src/pages/App/GroupVideoCall/GroupVideoCall.tsx`
- Cause: All peer connection logic coupled in one component
- Impact: Component re-renders inefficiently; difficult to test and maintain
- Improvement path: Extract peer connection management to custom hook; separate remote video rendering to sub-component

**Unbounded Processed Signals Set:**
- Problem: `processedSignalsRef` Set grows indefinitely, consuming memory
- Files: `src/pages/App/GroupVideoCall/GroupVideoCall.tsx` (line 31, 393, 462, 499)
- Cause: No cleanup of old signal IDs from processed set
- Impact: Memory leak in long-running video calls; could cause browser performance degradation
- Improvement path: Implement time-based cleanup or LRU cache for signal deduplication

**ICE Candidate Queue Unbounded:**
- Problem: `iceCandidateQueueRef` can accumulate candidates indefinitely per peer
- Files: `src/pages/App/GroupVideoCall/GroupVideoCall.tsx` (line 32, 310, 507-510)
- Cause: Candidates only cleared after remote description is set, but no maximum queue size
- Impact: Memory exhaustion in slow-to-establish connections
- Improvement path: Implement max queue size per peer; discard oldest candidates if queue exceeds limit

**Document List Without Pagination:**
- Problem: `documents.list()` collects all documents without pagination
- Files: `convex/documents.ts` (line 108)
- Cause: No pagination parameters in query
- Impact: Workspaces with thousands of documents will have slow queries
- Improvement path: Add paginationOpts parameter like messages.list()

**All Workspace Members Fetched for Every Push Notification:**
- Problem: Sends notification to all workspace users regardless of channel membership
- Files: `convex/pushNotifications.ts` (lines 53-67)
- Cause: Uses workspace members list without filtering by channel
- Impact: Unnecessary DB queries and notification sends; O(n) operations per message
- Improvement path: Implement channel-level member filtering (same as TODO comment already present)

## Fragile Areas

**WebRTC Peer Connection State Machine:**
- Files: `src/pages/App/GroupVideoCall/GroupVideoCall.tsx` (lines 194-296)
- Why fragile: Complex state transitions across multiple useEffects; peer connections created/destroyed in multiple places (lines 334, 408, 370); timing-sensitive ICE candidate handling
- Safe modification: Document state machine transitions first; add logging at each state change; write integration tests for connection sequences
- Test coverage: No test files found for video call logic; critical gap

**Channel Visibility Logic:**
- Files: `convex/channels.ts` (lines 9-45, 124-144)
- Why fragile: Public/private channel creation and deletion have different auth checks; logic branches on `isPublic` flag
- Safe modification: Extract permission checks to separate helper function; ensure all code paths covered by tests
- Test coverage: No tests found; manual testing insufficient

**Message Search:**
- Files: `convex/messages.ts` (lines 157-215)
- Why fragile: Search index may not be created if schema deployment fails; search results unvalidated on client
- Safe modification: Add healthcheck for search index; validate search term format; document required indexes
- Test coverage: No tests found

**Diagram Element Serialization:**
- Files: `convex/diagrams.ts` (line 183), `src/pages/App/Document/CustomBlocks/DiagramBlock.tsx`
- Why fragile: Excalidraw diagram content stored as string without validation; casting to `any` during mapping
- Safe modification: Define Excalidraw element types; validate on insert; parse carefully on retrieval
- Test coverage: No tests found

**Channel Role Count Tracking:**
- Files: `convex/channelMembers.ts` (lines 85-87, 136-141), `convex/channels.ts` (lines 32-35)
- Why fragile: `roleCount` object manually incremented/decremented; no atomic operation; count could desync with actual members
- Safe modification: Add reconciliation function that recounts actual members and corrects count; add invariant checks
- Test coverage: No tests found for role count correctness

## Scaling Limits

**Real-time Presence Updates:**
- Current capacity: Undocumented; uses Convex Presence which handles N users per document
- Limit: Video call implementation tracks all presence updates in single useEffect; could slow down with 100+ users in one call
- Scaling path: Implement sampling/throttling of presence updates; virtualize remote video list; paginate participant list

**WebRTC Mesh Topology:**
- Current capacity: Each user connects to every other user (full mesh)
- Limit: N users = N*(N-1) peer connections; becomes impractical above 6-10 users
- Scaling path: Implement selective forwarding unit (SFU) or MCU architecture; use video server for relay

**Signal Storage:**
- Current capacity: All signals stored indefinitely in database
- Limit: Database grows unbounded; old signals accumulate
- Scaling path: Implement signal cleanup job; delete signals older than 1 hour; use ephemeral signal storage

**Document Collaboration Bandwidth:**
- Current capacity: Undocumented; uses ProseMirror sync for edits
- Limit: Many simultaneous edits could overwhelm sync mechanism
- Scaling path: Monitor sync performance; implement edit batching; test with 10+ concurrent editors

## Dependencies at Risk

**@convex-dev/prosemirror-sync 0.2.1:**
- Risk: Pre-1.0 package with breaking changes possible
- Impact: Document collaboration could break on update
- Migration plan: Pin version; review changelog before upgrading; test document sync thoroughly

**@convex-dev/presence 0.3.0:**
- Risk: Pre-1.0 package; presence synchronization could be unreliable
- Impact: User presence indicators and video call participant lists could show stale data
- Migration plan: Test presence accuracy under network loss; consider fallback to polling

**@blocknote/core and @blocknote/react 0.33:**
- Risk: Pre-1.0 package; rapidly evolving API
- Impact: Document editing features could break
- Migration plan: Test before upgrading; have migration guide for schema changes

**web-push 3.6.7:**
- Risk: Older version; may have security issues
- Impact: Push notifications could be compromised
- Migration plan: Audit for CVEs; plan upgrade to latest version

## Missing Critical Features

**No Audit Logging:**
- Problem: No record of who accessed what documents/channels or when
- Blocks: Compliance requirements; security incident investigation
- Impact: Cannot answer "who saw this document?" or "when was this changed?"
- Fix approach: Add audit log table; log all mutations with user/timestamp; implement log retention policy

**No Two-Factor Authentication:**
- Problem: User accounts rely only on email/password
- Blocks: Security best practices for collaborative workspace
- Impact: Account takeover risk; password compromise affects all workspace data
- Fix approach: Integrate TOTP or WebAuthn; add 2FA enrollment in auth flow

**No Message Threading:**
- Problem: All messages in channel are flat list
- Blocks: Reducing noise in active channels; focused discussions
- Impact: Channel conversations hard to follow with 50+ messages
- Fix approach: Add reply_to field to messages; implement thread view

**No Notification Settings/Preferences:**
- Problem: Users receive all notifications without control
- Blocks: Notification management; muting channels
- Impact: User frustration; potential for alert fatigue
- Fix approach: Add notification preferences table; implement per-channel notification settings

**No Search History/Saved Searches:**
- Problem: Users can't recall previous searches or save common queries
- Blocks: Power user workflows; finding frequently accessed content
- Fix approach: Save searches table; implement search recency tracking

## Test Coverage Gaps

**GroupVideoCall Component:**
- What's not tested: WebRTC peer connection creation, ICE candidate handling, connection state transitions, stream setup, video track management
- Files: `src/pages/App/GroupVideoCall/GroupVideoCall.tsx`
- Risk: High - Complex WebRTC logic with many edge cases; one of the most critical user-facing features
- Priority: HIGH - Video calls are core feature; any regression affects multiple users

**Convex Mutations (all):**
- What's not tested: Role-based access control enforcement, permission boundaries, cascading deletes
- Files: All `convex/*.ts` mutation functions
- Risk: High - Security and data integrity failures won't be caught
- Priority: HIGH - Security-critical logic must be tested

**Channel Visibility Logic:**
- What's not tested: Public/private channel creation, member filtering, permission checks
- Files: `convex/channels.ts`, `convex/channelMembers.ts`
- Risk: Medium - Data visibility could be compromised
- Priority: HIGH - Core permission model

**Message Search:**
- What's not tested: Search index functionality, search result accuracy, ranking
- Files: `convex/messages.ts` search function
- Risk: Medium - Search failures would go unnoticed
- Priority: MEDIUM - Search is convenience feature, not critical path

**Authentication Flow:**
- What's not tested: OAuth providers (GitHub, Resend), email verification, password reset
- Files: `convex/auth.ts`, `convex/auth.config.ts`
- Risk: High - Authentication failures would block all users
- Priority: HIGH - Core functionality

**Push Notifications:**
- What's not tested: Notification sending, subscription management, error handling
- Files: `convex/pushNotifications.ts`, `convex/pushSubscription.ts`, `src/hooks/use-push-notifications.tsx`
- Risk: Medium - Notifications could silently fail
- Priority: MEDIUM - Feature works but lacks reliability guarantees

---

*Concerns audit: 2026-02-05*
