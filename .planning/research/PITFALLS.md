# Pitfalls Research: Chat @Mentions, Emoji Reactions, Reply-To

**Domain:** Adding @user mentions, emoji reactions, and inline reply-to to existing real-time chat application
**Researched:** 2026-02-07
**Confidence:** HIGH

## Executive Summary

This research identifies critical pitfalls when adding @mentions, emoji reactions, and inline reply-to to Ripple's existing Convex-powered real-time chat system. The system already has proven patterns for @mentions (task comments Phase 6.1), push notifications (task assignments), and BlockNote rich text (task descriptions). The primary risks center on **race conditions in reaction toggling**, **notification spam from @everyone abuse**, **performance degradation with embedded reactions**, and **stale reply-to previews when parent messages are deleted**.

Unlike implementing these features from scratch, the integration challenge is avoiding conflicts with existing optimistic updates, preventing schema bloat when messages already store BlockNote JSON, and ensuring consistency between chat mentions and task comment mentions. Convex's reactive subscriptions amplify race conditions—two users clicking the same reaction emoji simultaneously can result in duplicate reaction documents without proper deduplication.

**Critical insight:** Chat @mentions differ fundamentally from task comment @mentions. Task comments notify project members (bounded set), but chat channels can have hundreds of workspace members. An @everyone mention in a busy channel becomes a notification DOS attack. Prevention requires rate limiting and permission controls BEFORE building the feature, not as an afterthought.

## Critical Pitfalls

### Pitfall 1: Reaction Race Condition Without Deduplication
**What goes wrong:** Two users click the same emoji reaction simultaneously. Convex processes both mutations in parallel, each checks "does this user's reaction exist?" (answer: no for both), and both insert a reaction document. Result: User has two identical reactions, one visible in UI, one orphaned in database. When user tries to un-react, only one gets deleted, leaving the orphaned reaction forever.

**Why it happens:**
- Convex mutations run in parallel when invoked simultaneously from different clients
- "Check then insert" pattern creates race window between the check and insert operations
- Optimistic UI updates don't prevent server-side races (client shows correct state, server has duplicate data)
- Reactive queries hide the duplicate from UI (UI deduplicates by userId+emoji in map), making the bug invisible until database inspection

**How to avoid:**
- Use Convex **unique indexes** on `reactions` table: `.index("by_message_user_emoji_unique", ["messageId", "userId", "emoji"]).unique()` (planned Convex feature—currently not available, use query-before-mutate with awareness of race)
- NEVER use separate check + insert mutations—consolidate into single `toggleReaction` mutation
- Query + conditional insert pattern: `const existing = await ctx.db.query(...).first(); if (existing) { await ctx.db.delete(existing._id); } else { await ctx.db.insert(...); }`
- Accept that simultaneous clicks may result in non-deterministic final state (both users click within 100ms, one wins), but prevent data corruption
- Use `isomorphicId` pattern (like messages table) for client-generated unique keys, but problematic for reactions because "toggle" semantics mean same action should delete, not create duplicate

**Warning signs:**
- Database query shows `reactions.count() > messages.count()` by large margin (indicates duplicates)
- User reports "I un-reacted but the count is still wrong"
- Reactions table grows unbounded despite reaction removal
- Production logs show multiple inserts for same userId+messageId+emoji within milliseconds

**Phase to address:** Phase 1 (Schema Design) must include race condition mitigation in the mutation design. Don't defer to later phase—retrofitting is painful.

### Pitfall 2: Embedded Reactions Array Hits 8192 Limit
**What goes wrong:** Schema uses `messages.reactions: v.array(v.object({ userId, emoji }))` embedded in message document. Viral message in busy channel accumulates reactions. First 8000 reactions work fine, then the 8193rd reaction causes `ctx.db.patch()` to throw "Array size limit exceeded" error. Message becomes un-reactable. Worse: trying to remove reactions also requires patching the array, which fails, so reactions are permanently stuck.

**Why it happens:**
- Convex arrays limited to 8192 entries (per [Convex relationship structures documentation](https://stack.convex.dev/relationship-structures-let-s-talk-about-schemas))
- Popular messages in busy workspaces can accumulate hundreds of reactions (50 users × 5 different emojis = 250 reactions is common)
- Embedded arrays prevent selective updates—every reaction toggle requires rewriting entire array
- Document size grows unbounded as reactions accumulate (affects read performance even before hitting limit)

**How to avoid:**
- Use **separate `reactions` table** with many-to-one relationship to messages
- Schema: `reactions: defineTable({ messageId: v.id("messages"), userId: v.id("users"), emoji: v.string() }).index("by_message", ["messageId"]).index("by_message_user", ["messageId", "userId"])`
- Query reactions separately: `ctx.db.query("reactions").withIndex("by_message", q => q.eq("messageId", messageId))`
- Tradeoff: One extra query per message list, but selective inserts/deletes and no size limit
- Group reactions client-side: `reactions.reduce((acc, r) => { acc[r.emoji] = [...(acc[r.emoji] || []), r.userId]; return acc; }, {})`

**Warning signs:**
- Messages table documents approaching 1MB size (check with `await ctx.db.get(messageId)` and log byte size)
- Error logs showing "Array size limit exceeded"
- Reaction toggles becoming slower as message ages
- Database backup size growing disproportionately to message count

**Phase to address:** Phase 1 (Schema Design). Embedded arrays are architectural decision—can't migrate easily once production data exists.

### Pitfall 3: @everyone Mention Notification Bomb
**What goes wrong:** User types `@everyone` in busy channel with 500 workspace members. Mention extraction finds 500 userIds, notification mutation sends 500 push notifications simultaneously. Push notification service (web-push) rate limits or times out. Some notifications send, others fail silently. Users report "I was mentioned but didn't get notification" inconsistently. Worse: Malicious user discovers `@everyone` and spams it repeatedly, creating notification DOS attack.

**Why it happens:**
- Chat channels are workspace-scoped (Ripple's channels belong to workspaces, which can have hundreds of members)
- Task comment @mentions are project-scoped (projects typically have <20 members), so notification spam wasn't a concern
- Push notification infrastructure (convex/pushNotifications.ts) uses `Promise.allSettled()` on all subscriptions—scales poorly beyond 50-100 simultaneous sends
- No rate limiting on mention notifications (task system didn't need it)
- BlockNote @mention autocomplete shows all workspace members in chat, making @everyone pattern obvious

**How to avoid:**
- **Implement @channel and @here special mentions** with explicit permission checks (only channel admins can @channel)
- Rate limit mentions per message: `if (mentionedUserIds.length > 50) throw new ConvexError("Too many mentions")`
- Batch notification sends: `for (let i = 0; i < mentionedUserIds.length; i += 50) { await Promise.allSettled(batch); }`
- Add notification preference: `users.mentionNotificationPreference: "all" | "direct" | "none"` to allow users to opt out of @channel
- Log excessive mentions: `if (mentionedUserIds.length > 20) { console.warn("Excessive mentions", userId, messageId); }`
- Consider async notification queue instead of synchronous `ctx.scheduler.runAfter(0, ...)` pattern (Convex action rate limits may be hit)

**Warning signs:**
- Push notification action timing out (Convex actions have 10-minute limit)
- Notification delivery becoming inconsistent (some users get, others don't)
- Database logs showing same userId sending hundreds of notifications per hour
- User complaints about notification spam

**Phase to address:** Phase 2 (Mention Implementation) must include rate limiting BEFORE enabling @mentions. Don't ship without this—notification spam destroys user trust.

### Pitfall 4: Reply-To Parent Message Deleted (Stale Dangling References)
**What goes wrong:** User replies to Message A. Message A author deletes Message A (soft delete: `messages.deleted = true`). Reply message still shows "Replying to [Deleted message]" preview. User clicks preview to jump to context—nothing happens because parent message is filtered out by `undeleted_by_channel` index. Reply message looks broken. Worse: If hard delete (remove from DB), reply crashes trying to render `null` parent.

**Why it happens:**
- Replies store `replyToMessageId: v.id("messages")` reference, but no cascade delete or staleness check
- Messages use soft delete (`deleted: boolean` field), not hard delete, so reference remains valid but unusable
- UI queries messages with `undeleted_by_channel` index, which excludes deleted messages—reply's parent never appears in list
- Real-time updates mean parent can be deleted WHILE user is viewing reply (race between render and delete)

**How to avoid:**
- **Denormalize parent preview data** into reply message at creation time: `{ replyToMessageId, replyToAuthor: string, replyToPreview: string }` (first 100 chars of plainText)
- If parent deleted, show preview from denormalized data with "(message deleted)" indicator
- Don't allow clicking deleted parent preview (disable jump-to-message link if parent missing)
- Mutation: When inserting reply, fetch parent immediately and extract preview: `const parent = await ctx.db.get(replyToMessageId); if (!parent) throw new Error("Parent message not found"); const preview = parent.plainText.slice(0, 100);`
- Query: `const parent = await ctx.db.get(message.replyToMessageId); const isDeleted = parent?.deleted ?? true;`

**Warning signs:**
- Errors in console: "Cannot read property of null"
- Reply preview UI shows blank or "undefined"
- User reports "I clicked reply preview, nothing happened"
- Message list rendering delays (blocking on parent fetch for every reply)

**Phase to address:** Phase 3 (Reply-To Schema). Denormalization must be in initial schema—retrofitting requires migration.

### Pitfall 5: Mention Extraction Race Between Optimistic Update and Server Insert
**What goes wrong:** User types "@Alice hello" in chat, hits send. Optimistic UI immediately shows message in channel with @Alice highlighted. `messages.send` mutation runs, extracts mentions via `extractMentionedUserIds(body)`, sends notification, inserts message with same `isomorphicId`. But BlockNote JSON structure in optimistic update differs slightly from server-side JSON (editor normalizes whitespace differently). Mention extraction finds mention in optimistic update but not in server version, or vice versa. Alice gets notification but message doesn't show mention highlighting when it re-renders from server data.

**Why it happens:**
- BlockNote editor's `editor.document` serialization is non-deterministic for whitespace/formatting edge cases
- Optimistic update uses client's BlockNote version/serialization, server uses current deployed version
- `extractMentionedUserIds()` utility parses JSON structure—structural differences break extraction
- Convex reactive queries replace optimistic data with server data on insert, causing visual "flicker" if mention rendering differs

**How to avoid:**
- **Always serialize consistently** between client and server: Use same BlockNote version, same serialization config
- Test mention extraction with round-trip: `const doc = editor.document; const json = JSON.stringify(doc); const parsed = JSON.parse(json); assert(extractMentionedUserIds(json).length === expectedCount);`
- Validate mention extraction server-side BEFORE sending notifications: `if (mentionedUserIds.length === 0 && body.includes("userMention")) { console.error("Mention extraction failed", messageId); }`
- Use `isomorphicId` on messages to ensure optimistic update and server update refer to same message (already in schema)
- If client-side extraction needed for UI preview, ensure it uses same utility: `import { extractMentionedUserIds } from "convex/utils/blocknote"` (but Convex shared utils aren't importable client-side—needs duplication or shared package)

**Warning signs:**
- Notification sent but mention not highlighted in message
- Mention highlighted in optimistic UI, then disappears when server data loads
- Console errors: "extractMentionedUserIds returned empty array for message with mention"
- Flicker: message renders with mention, then without, then with again

**Phase to address:** Phase 2 (Mention Implementation). Test extraction thoroughly in both optimistic and server paths before considering feature complete.

### Pitfall 6: Reaction Count Query N+1 Problem at Scale
**What goes wrong:** Channel has 100 messages visible. Each message needs reaction count to display "👍 5" pills. Naive implementation: for each message, query `reactions.by_message` index. Result: 100 queries per message list render. Convex query latency is ~20-50ms, so 100 × 50ms = 5 seconds to render message list. UI feels sluggish. Scroll pagination loads more messages, each triggering another batch of queries.

**Why it happens:**
- Separate reactions table requires join to display counts (necessary to avoid embedded array limits)
- React components naively query reactions per message: `const reactions = useQuery(api.reactions.byMessage, { messageId })`
- Convex doesn't have built-in join queries—must manually aggregate
- Pagination loads 20 messages at a time, but each message queries independently

**How to avoid:**
- **Batch fetch reactions** for all visible messages in single query: `api.reactions.byMessages({ messageIds: string[] })`
- Use `getAll()` helper from convex-helpers: `const messages = paginatedMessages.page; const allReactions = await getAll(ctx.db, messages.map(m => m._id));` (but `getAll` is for documents by ID, not for one-to-many relationships)
- Better: Query all reactions in channel message range: `ctx.db.query("reactions").withIndex("by_channel_message", q => q.eq("channelId", channelId))` and group client-side
- Denormalize reaction counts into message document: `messages.reactionCounts: v.object({ "👍": v.number(), "❤️": v.number() })` (updated by reaction mutations)
- Tradeoff: Denormalized counts require updating message document on every reaction toggle (more writes, but much faster reads)

**Warning signs:**
- Convex query count in metrics dashboard grows proportionally to visible messages (100 messages = 100 queries)
- Message list render time increases with page size
- Browser devtools Network tab shows hundreds of Convex query requests
- Scroll performance degrades as more messages load

**Phase to address:** Phase 1 (Schema Design) should decide embedded vs denormalized counts. Phase 4 (Performance Optimization) if deferred, but user experience may suffer in Phase 2-3.

## Technical Debt Patterns

| Pattern | Why It Happens | Impact | Prevention |
|---------|---------------|--------|------------|
| Separate mutations for add/remove reaction | "Delete reaction" and "add reaction" feel like separate features | Race conditions, duplicate state management, inconsistent behavior | Single `toggleReaction` mutation with conditional logic |
| Inline reply stores only messageId reference | Minimal schema feels cleaner | Broken UI when parent deleted, expensive joins | Denormalize parent author + preview text (100 chars) |
| @mention extraction only in send mutation | "Notification is backend concern" | No client-side mention preview, no validation before send | Shared extraction utility (blocknote.ts) used in client + server (but Convex server utils not importable—needs shared package) |
| Reactions embedded in message document | "One query instead of two" | Array limit, document bloat, can't query "messages I reacted to" | Separate reactions table, accept one extra query |
| Plain text @everyone without permission check | "We'll add permissions later" | Notification spam in production | Permission check in Phase 2 before shipping, not "nice to have" |
| No rate limiting on mention notifications | "Our channels are small" | Scales poorly as workspace grows, open to abuse | Rate limit mentionedUserIds.length > 50 in Phase 2 |

## Performance Traps

| Trap | Symptoms | Query Pattern | Solution |
|------|----------|---------------|----------|
| N+1 reaction queries | Message list render takes 5+ seconds | `for (msg of messages) { useQuery(api.reactions.byMessage, { messageId: msg._id }) }` | Batch query: `api.reactions.byMessages({ messageIds })` returns reactions for all messages |
| Scanning all reactions for count | `reactions.count()` query scans full table | `ctx.db.query("reactions").filter(q => q.eq(q.field("messageId"), messageId)).collect()` (no index on messageId alone) | Use `by_message` index: `withIndex("by_message", q => q.eq("messageId", messageId))` |
| Mention extraction on every render | Re-parsing BlockNote JSON 60 times/sec (React re-renders) | `const mentions = extractMentionedUserIds(message.body)` in component body | Memoize with `useMemo(() => extractMentionedUserIds(message.body), [message.body])` |
| Reply parent lookup per message | Each reply fetches parent separately | `const parent = useQuery(api.messages.get, { messageId: replyToMessageId })` | Denormalize parent preview, only fetch parent on click |
| Unindexed reaction toggle check | Full table scan to find existing reaction | `filter(q => q.and(q.eq(q.field("userId"), userId), q.eq(q.field("emoji"), emoji)))` without index | Compound index: `by_message_user_emoji` on ["messageId", "userId", "emoji"] |

## UX Pitfalls

| Pitfall | User Experience | Root Cause | Solution |
|---------|----------------|------------|----------|
| Reaction animation flicker | Click 👍, appears briefly, disappears, reappears | Optimistic update conflict with server update | Use `isomorphicId` on reactions, client reconciles by ID not mutation order |
| @mention autocomplete shows deleted users | Autocomplete suggests "@John" but John left workspace | Autocomplete queries all users, not filtered by workspace membership | Query `workspaceMembers.by_workspace` first, then join to users |
| Reply preview truncates emoji/mentions | Preview shows "@Al..." (truncated mid-mention) | Naive `plainText.slice(0, 100)` cuts BlockNote inline content | Extract plain text preserving mention boundaries, or store structured preview |
| Can't un-react on deleted message | User reacted before deletion, now reaction stuck | Deleted messages excluded from UI, no way to access reaction toggle | Show deleted message placeholder with reactions still interactive |
| Multiple reactions appear on click | User clicks 👍 once, sees "👍 2" count | Race condition: check-then-insert pattern | Use `firstOrNull()` + conditional insert in single mutation transaction |
| Mention notification for self | User types "@Alice" in message, Alice gets notification even though Alice is the author | Mention extraction doesn't filter self | Filter authorId from mentionedUserIds: `mentionedUserIds.filter(id => id !== authorId)` |

## "Looks Done But Isn't" Checklist

Features that SEEM complete in local testing but fail in production:

- [ ] **Reaction race condition tested**: Two users click same emoji within 100ms—verify no duplicate reactions
- [ ] **Array limit tested**: Create message with 1000+ reactions—verify doesn't hit embedded array limit
- [ ] **@everyone tested**: Mention 500 users in channel—verify notifications don't timeout/fail
- [ ] **Reply parent deletion tested**: Delete parent message, verify reply preview still renders gracefully
- [ ] **Mention extraction consistency tested**: Optimistic update mentions match server-side extraction after insert
- [ ] **Notification spam prevention tested**: Rate limit prevents 100 @mentions in single message
- [ ] **Reaction query performance tested**: Load channel with 100 messages × 10 reactions each, verify < 1s render time
- [ ] **Deleted user mention tested**: @mention user, user leaves workspace, verify mention still renders (shows "Unknown")
- [ ] **Self-mention filtered**: User @mentions themselves, verify no notification sent to self
- [ ] **Reply to deleted message UX**: Click reply to deleted message, verify graceful "Message unavailable" instead of crash
- [ ] **Optimistic reaction toggle**: Click reaction, immediately un-click, verify no flicker or stuck state
- [ ] **Mention autocomplete member filtering**: Verify autocomplete only shows current workspace members, not all users

## Integration Pitfalls with Existing Ripple System

| Existing Feature | Integration Risk | Why | Mitigation |
|-----------------|------------------|-----|------------|
| Message optimistic updates (isomorphicId) | Reactions need same isomorphicId pattern to reconcile optimistic/server data | Messages use `isomorphicId` for deduplication, reactions would need similar | Add `isomorphicId` to reactions schema OR use compound unique index (messageId + userId + emoji) |
| Push notifications (scheduler.runAfter) | Chat mentions reuse notification system, but channel size >> project size | Task notifications send to 5-20 people, chat could send to 500 | Rate limit mentionedUserIds.length, add permission check for @channel |
| BlockNote schemas (task descriptions vs comments vs chat) | Three different BlockNote schemas—inconsistency confuses users | Task descriptions have 4 inline types, comments have 1, chat would have 2+ | Create `chatMessageSchema.ts` with only userMention + link (minimal), document decision in SCHEMA.md |
| Soft delete (messages.deleted boolean) | Reply-to references deleted messages, but UI filters them out | Channel message list uses `undeleted_by_channel` index | Denormalize parent preview OR show deleted message placeholders in reply chains |
| Channel pagination (20 messages per page) | Reaction queries multiply by page size—N+1 problem | Each message queries reactions separately | Batch query reactions for entire page, not per-message |
| Real-time subscriptions | Race conditions amplified by Convex reactive queries | Two users see update simultaneously, both mutate, both succeed in parallel | Use unique indexes (when available) or accept non-deterministic final state with idempotent mutations |

## Convex-Specific Pitfalls

### Mutations Can't Call Other Mutations
**Problem:** Reaction toggle wants to call `addReaction()` or `removeReaction()` based on state.
**Why it fails:** Convex mutations can't invoke other mutations (from CLAUDE.md: "Mutations can't call other mutations").
**Solution:** Inline conditional logic in single `toggleReaction` mutation. Extract shared logic into internal helper function (not exported mutation).

### Can't Index Arrays
**Problem:** Want to query "messages user X reacted to" with `messages.reactions: v.array(...)`.
**Why it fails:** Convex arrays not indexable (from WebSearch result: "You can't index an array in Convex").
**Solution:** Separate `reactions` table with `by_user` index. Query: `ctx.db.query("reactions").withIndex("by_user", q => q.eq("userId", userId))`.

### No Built-in Unique Constraints
**Problem:** Prevent duplicate reactions (same userId + emoji on same message).
**Why it fails:** Convex schema lacks unique constraints (`.unique()` index flag exists in schema but not enforced at write time—must manually check).
**Solution:** Query-before-insert pattern: `const existing = await ctx.db.query(...).withIndex("by_message_user_emoji", ...).first(); if (!existing) { await ctx.db.insert(...); }`. Accept race condition edge case where simultaneous clicks create duplicate (eventual consistency via client-side deduplication in UI).

### Reactive Queries Replace Optimistic Updates
**Problem:** User clicks reaction, sees immediate optimistic update, then Convex reactive query replaces it with server data 100ms later, causing flicker.
**Why it happens:** Convex's reactivity model replaces client state with server state automatically. If client and server data structures differ (even slightly), UI flickers.
**Solution:** Ensure optimistic update structure EXACTLY matches server return structure. Use `isomorphicId` for client-generated IDs so Convex can reconcile. For reactions, optimistic update must include: `{ _id: tempId, messageId, userId, emoji, _creationTime: Date.now() }` matching server document shape.

### Filter Without Index = Full Table Scan
**Problem:** `ctx.db.query("reactions").filter(q => q.eq(q.field("messageId"), messageId))` scans all reactions.
**Why it fails:** Convex requires `withIndex()` for performant queries (from CLAUDE.md: "Use withIndex() instead of filter()").
**Solution:** Define `by_message` index in schema, use: `ctx.db.query("reactions").withIndex("by_message", q => q.eq("messageId", messageId))`. Filter is only for non-indexed fields AFTER indexed lookup.

### Scheduled Actions Rate Limits
**Problem:** `ctx.scheduler.runAfter(0, internal.notifications.sendMentionNotifications, ...)` called 500 times for @everyone mention.
**Why it fails:** Convex rate limits scheduled action invocations (specific limits not documented publicly, but observed failures at high scale).
**Solution:** Batch notification sends INSIDE the action, not via 500 separate scheduled actions. Single action invocation that iterates `mentionedUserIds` and sends in batches of 50.

## Pitfall-to-Phase Mapping

| Phase | Must Address | Nice to Have | Defer to Later |
|-------|-------------|--------------|----------------|
| **Phase 1: Schema Design + Reactions** | Separate reactions table (avoid embedded array limit), by_message index, by_message_user_emoji compound index, toggleReaction mutation with race mitigation | Denormalized reaction counts in messages | Unique constraint enforcement (not critical—client dedupes) |
| **Phase 2: @Mentions in Chat** | Rate limit mentionedUserIds.length > 50, filter self-mentions, reuse extractMentionedUserIds utility, batch notification sends, chatMessageSchema with userMention | @channel/@here special mentions with permissions, notification preferences | @everyone mention (too risky without more controls) |
| **Phase 3: Inline Reply-To** | Denormalize parent author + preview in reply, graceful deleted parent handling, replyToMessageId field | Jump-to-message scroll, threaded reply visualization | Full threading (out of scope—inline only) |
| **Phase 4: Performance + Polish** | Batch reaction queries for message page, memoize mention extraction, optimistic reaction toggle, mention autocomplete member filtering | Reaction animation polish, reply preview rich text | N/A |

## Sources

### Primary (HIGH confidence)
- Existing codebase: `convex/schema.ts` - Messages table structure, indexes, soft delete pattern
- Existing codebase: `convex/messages.ts` - Optimistic update pattern (isomorphicId), pagination query
- Existing codebase: `convex/tasks.ts` - Notification scheduling pattern (scheduler.runAfter)
- Existing codebase: `convex/utils/blocknote.ts` - Mention extraction utility for task descriptions
- Existing codebase: `.planning/phases/06.1-mention-people-in-task-comments/06.1-RESEARCH.md` - BlockNote mention implementation patterns
- [Convex Relationship Structures: Let's Talk About Schemas](https://stack.convex.dev/relationship-structures-let-s-talk-about-schemas) - Array limits (8192 entries), relationship patterns, indexing constraints
- [Opinionated Convex guidelines](https://gist.github.com/srizvi/966e583693271d874bf65c2a95466339) - Best practices for schema design, queries, mutations

### Secondary (MEDIUM confidence)
- [Concurrent Optimistic Updates in React Query](https://tkdodo.eu/blog/concurrent-optimistic-updates-in-react-query) - Race condition patterns in optimistic UI
- [Optimistic State: Rollbacks and Race Condition Handling](https://github.com/perceived-dev/optimistic-state) - Race condition prevention strategies
- [MongoDB Embedded Data vs References](https://www.mongodb.com/docs/manual/data-modeling/concepts/embedding-vs-references/) - Embedded vs separate table tradeoffs (Convex uses similar document model)
- [PubNub: Automate Spam Detection and Prevention](https://www.pubnub.com/blog/automate-spam-detection-and-prevention/) - Mention spam prevention patterns
- [WhatsApp Tests 'Mention Everyone' Option - Spam Concerns](https://www.digitalinformationworld.com/2025/09/whatsapp-tests-mention-everyone-option.html) - @everyone abuse patterns

### Tertiary (LOW confidence)
- [Threads & Replies - React Chat Messaging Docs](https://getstream.io/chat/docs/react/threads/) - General threading patterns (not Convex-specific)
- [Telegram Desktop Issue #10315: Deleted message in reply not disappearing](https://github.com/telegramdesktop/tdesktop/issues/10315) - Stale reply references in production
- [Element Android Issue #2236: Replies to deleted messages visible](https://github.com/element-hq/element-android/issues/2236) - Reply-to-deleted UX patterns

## Metadata

**Confidence breakdown:**
- Schema design pitfalls: HIGH (based on existing Ripple schema + Convex docs)
- Race conditions: HIGH (Convex concurrency model + existing optimistic update patterns in codebase)
- Notification spam: MEDIUM (based on WebSearch results + task notification patterns in codebase)
- Performance: HIGH (Convex index requirements in CLAUDE.md + relationship docs)
- Reply-to pitfalls: MEDIUM (based on other chat app issues, not Ripple-specific testing)

**Research date:** 2026-02-07
**Valid until:** 30 days (Convex features stable, chat patterns well-established)
**Reviewer notes:** This research focuses on INTEGRATION pitfalls specific to adding features to Ripple's existing system. Generic chat feature pitfalls (e.g., "emoji picker performance") intentionally excluded. Emphasis on Convex-specific constraints (mutations can't call mutations, arrays not indexable, filter requires index) because these differ from traditional backend patterns.
