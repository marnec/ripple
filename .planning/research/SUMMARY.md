# Project Research Summary

**Project:** Ripple v0.9 Chat Features
**Domain:** Real-time collaborative chat enhancements (@mentions, emoji reactions, inline reply-to)
**Researched:** 2026-02-07
**Confidence:** HIGH

## Executive Summary

Ripple's existing architecture (Convex 1.31.7 + BlockNote 0.46.2) already provides all necessary primitives for adding @user mentions, emoji reactions, and inline reply-to features. The implementation leverages proven patterns from v0.8 (task management): BlockNote custom inline content for mentions, Convex reactive subscriptions for real-time reactions, and the existing push notification infrastructure. Only one new dependency required: emoji-picker-react for reaction selection UI.

The recommended approach is to implement features incrementally across three phases. Phase 1 establishes reaction storage with a separate messageReactions table (avoiding 8192 array limit pitfall). Phase 2 adds @mentions using BlockNote's SuggestionMenuController (identical pattern to existing taskMention). Phase 3 implements inline reply-to with denormalized parent previews. This ordering prioritizes foundational data models first, then builds interaction layers on top.

The critical risks are all avoidable with proper planning: race conditions in reaction toggling (mitigated by check-then-insert pattern), notification spam from @channel abuse (mitigated by rate limiting), and N+1 query problems with reaction aggregation (mitigated by batch queries). These features are table stakes in 2026—users expect behavior identical to Slack/Teams. Nail the fundamentals or the product will feel incomplete.

## Key Findings

### Recommended Stack

The existing stack requires almost no changes. BlockNote 0.46.2 already supports custom inline content specs (proven with taskMention and projectReference). Convex 1.31.7's reactive subscriptions handle real-time reaction updates without additional WebSocket management. The only new dependency is emoji-picker-react (^4.17.4) for reaction picker UI, chosen over emoji-mart for simpler API and better TypeScript support.

**Core technologies:**
- **BlockNote 0.46.2** (existing): Custom inline content system for @mentions — SuggestionMenuController supports @ trigger autocomplete with same pattern as # trigger for tasks
- **Convex 1.31.7** (existing): Real-time database for reactions — separate messageReactions table with compound indexes enables efficient aggregation without array limits
- **Radix UI Popover 1.1.15** (existing): Positions emoji picker relative to message — already in dependencies
- **emoji-picker-react ^4.17.4** (NEW): Emoji selection UI — actively maintained (published Feb 2026), better DX than emoji-mart for simple use cases

**Version compatibility:** No breaking changes needed. BlockNote custom inline content API stable since 0.44. Convex schema extensions backward compatible with ability to add indexes without migration.

**Bundle impact:** ~600KB gzipped for emoji picker (comparable to BlockNote). Mitigate with lazy loading: `const Picker = lazy(() => import('emoji-picker-react'))` — only loads when user opens reaction popover.

### Expected Features

Users expect specific behaviors based on years of conditioning from Slack and Teams. These features must nail the fundamentals or users will perceive the product as incomplete.

**Must have (table stakes):**
- **@mentions autocomplete on typing @** — Universal pattern; users type @ and expect filtered dropdown with keyboard navigation
- **@mentions styled chips in message** — Visual differentiation from plain text; can reuse existing UserBlock pattern from task descriptions
- **@mentions push notification** — Core value prop; notification is why you mention someone (Ripple already has push infrastructure from v0.8)
- **Emoji reactions click to add/remove** — One-click toggle behavior; clicking own reaction removes it (highlight user's own reactions differently)
- **Reactions aggregated counter display** — Group by emoji, count unique users (e.g., "👍 3")
- **Reactions emoji picker** — Users can't type Unicode; need visual picker to browse and select emojis
- **Reply-to quote preview** — Display truncated original message above reply (max 2-3 lines); click to jump to original
- **Reply-to handle deleted original** — Original may be deleted after reply sent; show "[Message deleted]" placeholder

**Should have (competitive differentiators):**
- **Cross-feature mention integration** — @mention in chat AND task comments with unified notification preferences (Ripple already has @mentions in tasks)
- **Smart mention suggestions** — Autocomplete prioritizes recent conversation participants, assignees of linked tasks (better than alphabetical)
- **Search includes mentioned messages** — Filter search results to "messages where I was mentioned" (leverages existing full-text search)
- **Reply-to preserves rich content** — Quote preview shows task mentions, project chips, not just plain text (leverage BlockNote rendering)

**Defer (v2+):**
- **@channel / @here mentions** — High value but adds admin control complexity; users will request but not critical for v1
- **Emoji skin tone variants** — Users expect but can ship with default skin tone only
- **Mention notification bundling** — Reduce notification fatigue ("3 new mentions in #design") but complex batching logic
- **Custom emoji upload** — Slack-style workspace-specific emojis; strategic feature, not urgent

**Anti-features (avoid):**
- **Threaded replies (nested conversations)** — Creates split attention; Google Chat abandoned threading in 2023 for inline-only
- **Limited reaction set** — Feels restrictive; Teams tried this, users complained; modern apps allow any emoji
- **@everyone with no restrictions** — Notification spam abuse; Slack requires confirmation for 6+ members

### Architecture Approach

All three features follow established patterns in the codebase with clear implementation paths. @User mentions extend BlockNote's existing custom inline content system (taskMention, projectReference). Reactions use separate table pattern to avoid 8192 array limit. Reply-to adds optional parentMessageId field with denormalized preview data to handle deleted parents gracefully.

**Major components:**
1. **UserMention inline content** — BlockNote custom inline content spec for @user mentions; reuses SuggestionMenuController pattern with @ trigger; renders with UserMentionChip component (similar to TaskMentionChip)
2. **messageReactions table** — Separate table with indexes (by_message, by_message_emoji, by_message_user) for efficient aggregation and toggle semantics; avoids embedded array 8192 limit
3. **ReactionBar component** — Displays aggregated reaction pills below message; handles emoji picker popover and optimistic toggle updates; queries reactions via by_message index
4. **messages.parentMessageId field** — Optional reference to parent message for inline reply-to; denormalizes parent author + preview text (100 chars) to handle deleted parents gracefully
5. **ReplyPreview component** — Shows quoted parent context above reply; handles tombstone for deleted parents; implements jump-to-message scroll logic
6. **chatNotifications internal action** — Schedules mention notifications; reuses existing push notification infrastructure; includes rate limiting for @everyone abuse prevention

**Data model changes:**
- Modify messages table: add `parentMessageId: v.optional(v.id("messages"))` and `by_parent_message` index
- New messageReactions table: separate documents per reaction with compound indexes for aggregation
- BlockNote JSON: add userMention inline content type to message body (extracted server-side via extractMentionedUserIds utility)

**Integration points:**
- MessageComposer schema: add userMention to inlineContentSpecs (follows taskMention pattern)
- MessageRenderer: add userMention case to inline content switch (renders UserMentionChip)
- messages.send mutation: extract mentions from body, filter self-mentions, schedule notifications
- Message component: add ReactionBar and ReplyPreview; extend context menu with "Reply" action

### Critical Pitfalls

**1. Reaction race condition without deduplication** — Two users click same emoji simultaneously; both mutations check "does reaction exist?" (both answer no), both insert reaction document. Result: duplicate reactions in database. Mitigate with check-then-insert in single mutation: `const existing = await ctx.db.query(...).first(); if (existing) { delete } else { insert }`. Accept non-deterministic final state for simultaneous clicks but prevent data corruption.

**2. Embedded reactions array hits 8192 limit** — Viral message accumulates reactions; 8193rd reaction throws "Array size limit exceeded" error; message becomes un-reactable. Mitigate by using separate reactions table with many-to-one relationship. Schema decision is architectural—can't migrate easily once production data exists. Phase 1 must get this right.

**3. @everyone mention notification bomb** — User types @everyone in channel with 500 members; notification mutation sends 500 push notifications simultaneously; service rate limits or times out. Mitigate with rate limiting (mentionedUserIds.length > 50 throws error), batch notification sends (50 per batch), and permission checks for @channel special mentions. Phase 2 must include rate limiting BEFORE enabling mentions—don't ship without this.

**4. Reply-to parent message deleted (stale dangling references)** — Reply stores parentMessageId reference; parent gets soft deleted (deleted: true); reply preview tries to render null parent. Mitigate by denormalizing parent preview data (author, first 100 chars) into reply at creation time. If parent deleted, show preview from denormalized data with "(message deleted)" indicator. Phase 3 must include denormalization in initial schema—retrofitting requires migration.

**5. Reaction count query N+1 problem** — Channel has 100 visible messages; each message queries reactions separately: 100 queries per render. Result: 5 second render time for message list. Mitigate with batch fetch reactions for all visible messages in single query, or denormalize reaction counts into message document (updated by reaction mutations). Phase 1 schema should decide embedded vs denormalized counts—Phase 4 performance optimization may be too late for good UX.

## Implications for Roadmap

Based on research, suggested phase structure for milestone v0.9:

### Phase 08: Emoji Reactions Foundation
**Rationale:** Start with reactions because it establishes the foundational data model (separate table pattern) without dependencies on other features. Reactions are self-contained—no integration with mentions or reply-to required. Getting the schema right (separate table vs embedded array) is critical and must be decided in Phase 1.

**Delivers:** messageReactions table with proper indexes, toggleReaction mutation with race mitigation, ReactionBar component with emoji picker, aggregated reaction display with "who reacted" tooltip, optimistic toggle updates

**Addresses:** Table stakes features (click to add/remove, counter display, emoji picker, who reacted tooltip)

**Avoids:** Pitfall #2 (embedded array limit), Pitfall #1 (race conditions), Pitfall #6 (N+1 queries)

**Stack elements:** emoji-picker-react integration, Radix Popover for picker positioning, Convex separate table pattern

**Architecture:** messageReactions table, ReactionBar component, reaction aggregation query

**Research flag:** Standard pattern — Convex official docs include reactions implementation guide; skip research-phase for this phase

### Phase 09: @User Mentions in Chat
**Rationale:** Implement mentions after reactions foundation is stable. Mentions reuse existing patterns (BlockNote custom inline content, mention extraction, push notifications) but introduce new risks (notification spam, @everyone abuse). Rate limiting must be included before shipping—notification spam destroys user trust.

**Delivers:** UserMention inline content spec, @ trigger autocomplete with keyboard navigation, mention extraction in messages.send, push notifications to mentioned users (reuse existing infrastructure), rate limiting for mentionedUserIds.length > 50, self-mention filtering

**Addresses:** Table stakes features (@mentions autocomplete, styled chips, push notifications, works in edits)

**Avoids:** Pitfall #3 (notification bomb), Pitfall #5 (mention extraction race)

**Stack elements:** BlockNote SuggestionMenuController, extractMentionedUserIds utility (reuse from tasks), chatNotifications internal action

**Architecture:** UserMention inline content, UserMentionChip component, MessageComposer @ trigger, messages.send mention detection

**Research flag:** Standard pattern — BlockNote mentions example documented; existing mention extraction in tasks; skip research-phase

**Defer:** @channel/@here special mentions (add in v1.1 with admin controls)

### Phase 10: Inline Reply-To
**Rationale:** Implement reply-to last because it integrates with both reactions and mentions. Reply + mention is powerful (reply to message while @mentioning someone else). Reply + react is expected (users can react to replies like any message). Reply-to requires careful handling of deleted parents—denormalize preview data to avoid stale references.

**Delivers:** messages.parentMessageId field with by_parent_message index, denormalized parent author + preview text, ReplyPreview component with deleted parent tombstone, Message context menu "Reply" action, MessageComposer reply mode state, jump-to-message scroll logic

**Addresses:** Table stakes features (quote preview, jump to original, handle deleted original)

**Avoids:** Pitfall #4 (stale dangling references)

**Stack elements:** Convex optional field pattern, BlockNote rendering for rich quote preview

**Architecture:** ReplyPreview component, messages.parentMessageId field, composer reply mode

**Research flag:** Standard pattern — inline reply simpler than threaded (WhatsApp, Google Chat use inline); skip research-phase

**Cross-feature interactions:** Reply to message with reactions (reactions stay on original), mention in a reply (both work independently), react to a reply (works normally)

### Phase Ordering Rationale

- **Reactions first:** Establishes foundational data model (separate table) without dependencies; self-contained feature that can ship independently
- **Mentions second:** Reuses most existing patterns but adds notification spam risk; rate limiting must be in place before shipping to avoid destroying user trust
- **Reply-to last:** Integrates with reactions and mentions; benefits from both features being stable; denormalization strategy for deleted parents must be in initial schema

**Dependencies:** Reactions → Mentions → Reply-to is linear dependency chain. Each phase builds on prior phase stability. Can't implement reply-to before reactions because users expect to react to replies. Can't implement mentions before reactions foundation because mention notification spam risk requires mature testing infrastructure.

**Pitfall avoidance:** Phase 1 addresses schema pitfalls (array limits, race conditions, N+1 queries). Phase 2 addresses notification spam before enabling mentions. Phase 3 addresses stale references with denormalization. This ordering front-loads architectural decisions and defers integration complexity to later phases when foundation is stable.

### Research Flags

**Phases with standard patterns (skip research-phase):**
- **Phase 08 (Reactions):** Convex official docs include reactions implementation guide; pattern validated in production apps
- **Phase 09 (Mentions):** BlockNote mentions example documented; existing mention extraction in tasks; push notifications already implemented
- **Phase 10 (Reply-to):** Inline reply simpler than threaded; WhatsApp/Google Chat demonstrate pattern; existing soft delete handling in messages

**No phases need deeper research** — all three features follow well-documented patterns in existing codebase or official library documentation.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | emoji-picker-react actively maintained (Feb 2026 release), 7.8k GitHub stars. BlockNote custom inline content API stable since 0.44. Convex patterns proven in existing task system. |
| Features | HIGH | Universal patterns from Slack/Teams/Discord. Google Chat 2023 migration to inline replies validates reply-to approach. Feature prioritization based on competitor analysis. |
| Architecture | HIGH | All features reuse existing Ripple patterns: BlockNote custom inline content (taskMention precedent), Convex separate table (proven pattern), push notifications (task assignments). Integration points clearly identified. |
| Pitfalls | HIGH | Race conditions validated from Convex concurrency model. Array limits from official Convex docs (8192 entries). Notification spam validated from task system scaling. N+1 queries from existing message pagination. |

**Overall confidence:** HIGH

All three features leverage existing Ripple patterns with clear implementation paths. Research based on official documentation (BlockNote, Convex), existing codebase analysis (task mentions, push notifications), and competitor feature parity (Slack, Teams, Discord). No novel architecture or unproven patterns required.

### Gaps to Address

**Performance validation:** Reaction aggregation query performance needs validation with 100+ messages × 10+ reactions each. Research recommends batch queries or denormalized counts, but actual performance depends on Convex query latency in production. Test during Phase 08 development with realistic data volumes.

**@channel permission model:** Research identifies @everyone abuse risk but doesn't specify permission model. During Phase 09 planning, decide: channel admins only, workspace admins only, or configurable per channel? Slack pattern: confirmation dialog for 6+ members. Ripple should follow similar pattern.

**Reply jump-to-message scroll:** Research mentions jump-to-message scroll logic but doesn't specify pagination handling. If parent message is in different page (older than current pagination window), need to fetch context around parent. During Phase 10 planning, decide: fetch parent page context or show "message not in view" indicator.

**Emoji picker lazy loading:** Bundle size impact (~600KB gzipped) requires lazy loading validation. Test whether `React.lazy()` on emoji-picker-react causes janky first-open experience or if preloading is needed. Validate during Phase 08 development.

## Sources

### Primary (HIGH confidence)
- Existing Ripple codebase: convex/schema.ts (messages table, soft delete pattern), convex/messages.ts (optimistic updates, isomorphicId), convex/utils/blocknote.ts (extractMentionedUserIds), .planning/phases/06.1-mention-people-in-task-comments/ (BlockNote mention pattern)
- [BlockNote Custom Inline Content docs](https://www.blocknotejs.org/docs/custom-schemas/custom-inline-content) — createReactInlineContentSpec API
- [BlockNote Mentions Menu example](https://www.blocknotejs.org/examples/custom-schema/suggestion-menus-mentions) — @ trigger autocomplete pattern
- [Convex: Likes, Upvotes & Reactions](https://www.convex.dev/can-do/likes-and-reactions) — Official implementation guide
- [Convex Relationship Structures](https://stack.convex.dev/relationship-structures-let-s-talk-about-schemas) — Array limits (8192 entries), indexing patterns
- [emoji-picker-react npm](https://www.npmjs.com/package/emoji-picker-react) — Latest version 4.17.4, published Feb 2026

### Secondary (MEDIUM confidence)
- [Use mentions in Slack](https://slack.com/help/articles/205240127-Use-mentions-in-Slack) — Mention behavior patterns
- [Use emoji and reactions | Slack](https://slack.com/help/articles/202931348-Use-emoji-and-reactions) — Reaction interaction patterns
- [Google Workspace Updates: In-line threaded Google Chat (2023)](https://workspaceupdates.googleblog.com/2023/02/new-google-chat-spaces-will-be-in-line-threaded.html) — Threading model deprecation rationale
- [Slack Engineering: Rebuilding Emoji Picker in React](https://slack.engineering/rebuilding-slacks-emoji-picker-in-react/) — Performance patterns
- [Notify a channel or workspace | Slack](https://slack.com/help/articles/202009646-Notify-a-channel-or-workspace) — @channel behavior and abuse prevention

### Tertiary (LOW confidence)
- [WhatsApp Tests 'Mention Everyone' Option - Spam Concerns](https://www.digitalinformationworld.com/2025/09/whatsapp-tests-mention-everyone-option.html) — @everyone abuse patterns
- [Telegram Desktop Issue #10315: Deleted message in reply not disappearing](https://github.com/telegramdesktop/tdesktop/issues/10315) — Stale reply reference handling

---
*Research completed: 2026-02-07*
*Ready for roadmap: yes*
