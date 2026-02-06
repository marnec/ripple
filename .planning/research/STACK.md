# Stack Research: Chat Mentions, Reactions, and Reply-To

**Domain:** Real-time collaborative chat enhancements (mentions, reactions, threading)
**Researched:** 2026-02-07
**Confidence:** HIGH

## Executive Summary

The existing stack (Convex 1.31.7, BlockNote 0.46.2, React 18, Radix UI) already provides most primitives needed. Only one new dependency required: an emoji picker library for reaction selection. @user mentions leverage existing BlockNote custom inline content pattern. Reply-to threading requires only schema additions, no new libraries.

## Recommended Stack

### Core Technologies (No Changes)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| BlockNote | 0.46.2 (existing) | Rich text editor with custom inline content | Already integrated for chat composer. Built-in SuggestionMenuController supports @mention autocomplete with trigger characters. Project already uses custom inline specs (taskMention, projectReference) - user mentions follow same pattern. |
| Convex | 1.31.7 (existing) | Real-time database with subscriptions | Already stores messages table. Reactions require new `messageReactions` table with compound indexes. Convex reactivity ensures real-time reaction updates without WebSocket management. |
| Radix UI Popover | 1.1.15 (existing) | Popover primitive for emoji picker | Already in dependencies. Positions emoji picker relative to reaction button trigger. |

### Supporting Libraries (New Addition)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **emoji-picker-react** | ^4.17.4 | Emoji selection UI for reactions | Render inside Radix Popover when user clicks reaction button. Actively maintained (published 4 days ago as of Feb 2026). Better DX than emoji-mart for simple use cases. |

## Installation

```bash
# Single new package
npm install emoji-picker-react@^4.17.4
```

## Implementation Details

### 1. @User Mentions

**No new libraries needed.** Leverage existing BlockNote patterns:

```typescript
// Extend existing schema (MessageComposer.tsx)
const schema = BlockNoteSchema.create({
  blockSpecs: { ...remainingBlockSpecs },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    taskMention: TaskMention,        // existing
    projectReference: ProjectReference, // existing
    userMention: UserMention,         // NEW - follows same pattern
  },
});

// Add SuggestionMenuController for "@" trigger
<SuggestionMenuController
  triggerCharacter={"@"}
  getItems={async (query) => {
    // Query workspace members via Convex
    return workspaceMembers
      .filter(m => m.name.includes(query))
      .map(m => ({
        title: m.name,
        onItemClick: () => {
          editor.insertInlineContent([
            { type: "userMention", props: { userId: m._id, userName: m.name } },
            " ",
          ]);
        },
      }));
  }}
/>
```

**Pattern precedent:** Project already implements taskMention and projectReference using `createReactInlineContentSpec`. User mentions are structurally identical - just a different data source (workspaceMembers instead of tasks/projects).

**Why BlockNote native vs mention library:** BlockNote's custom inline content system provides:
- Type-safe props (userId, userName)
- Editor-time preview rendering
- Serialization to JSON (stored in message body)
- No external dependency conflicts

### 2. Emoji Reactions

**Requires emoji-picker-react for picker UI.**

#### Database Schema

```typescript
// convex/schema.ts - NEW TABLE
messageReactions: defineTable({
  messageId: v.id("messages"),
  userId: v.id("users"),
  emoji: v.string(),              // native emoji character (e.g., "👍")
  channelId: v.id("channels"),    // denormalized for efficient queries
})
  .index("by_message", ["messageId"])
  .index("by_message_emoji", ["messageId", "emoji"])        // count reactions per emoji
  .index("by_message_user", ["messageId", "userId"])        // prevent duplicate reactions
  .index("by_channel", ["channelId"])                       // cleanup when channel deleted
```

**Why this schema:**
- `by_message_emoji` enables aggregation: "👍 3, ❤️ 5" counts
- `by_message_user` enforces uniqueness: user can only react once per emoji per message
- Stores native emoji string (not emoji codes) for simplicity
- `channelId` denormalized for cascade deletion patterns

#### UI Implementation

```typescript
// Reaction picker (Radix Popover + emoji-picker-react)
import Picker from 'emoji-picker-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';

<Popover>
  <PopoverTrigger asChild>
    <Button variant="ghost" size="sm">Add Reaction</Button>
  </PopoverTrigger>
  <PopoverContent>
    <Picker
      onEmojiClick={(emojiData) => {
        addReaction({ messageId, emoji: emojiData.emoji });
      }}
    />
  </PopoverContent>
</Popover>
```

**Why emoji-picker-react over emoji-mart:**
- Simpler API - single component import vs modular data loading
- Actively maintained (v4.17.4 published Feb 2026)
- Better TypeScript types out of the box
- Bundle size acceptable (2.59MB) given feature richness
- emoji-mart's modular data loading adds complexity without significant benefit for this use case

**Tradeoff:** emoji-mart has smaller bundle (45KB gzipped with emoji-mart-lite) but requires manual data management. For a chat app where emojis are secondary feature (not primary like Slack), emoji-picker-react's DX wins.

### 3. Inline Reply-To

**No new libraries needed.** Pure data modeling + UI.

#### Database Schema

```typescript
// convex/schema.ts - MODIFY EXISTING TABLE
messages: defineTable({
  userId: v.id("users"),
  isomorphicId: v.string(),
  body: v.string(),
  plainText: v.string(),
  channelId: v.id("channels"),
  deleted: v.boolean(),
  replyToMessageId: v.optional(v.id("messages")), // NEW - reference to parent message
})
  .index("by_channel", ["channelId"])
  .index("undeleted_by_channel", ["channelId", "deleted"])
  .index("by_reply_to", ["replyToMessageId"])      // NEW - fetch all replies to a message
  .searchIndex("by_text", { searchField: "plainText", filterFields: ["channelId"] })
```

**Pattern:** Inline reply (quoted parent preview in chat flow), NOT threaded replies (separate thread view). Matches Slack/Discord UX.

#### UI Pattern

```typescript
// Message with reply-to preview
{message.replyToMessageId && (
  <div className="border-l-2 border-muted pl-2 mb-1 text-sm text-muted-foreground">
    <QuotedMessage messageId={message.replyToMessageId} />
  </div>
)}
<MessageRenderer body={message.body} />
```

**Why inline vs threaded:**
- Simpler UX for linear chat flow
- No thread view management
- Matches existing chat message layout
- Can upgrade to threads later if needed (schema already supports it)

## Alternatives Considered

| Category | Recommended | Alternative | Why Not Alternative |
|----------|-------------|-------------|---------------------|
| Emoji Picker | emoji-picker-react | emoji-mart | Modular data loading adds complexity. emoji-mart-lite saves 2.5MB but requires manual emoji data imports. Not worth engineering time for marginal bundle savings in chat app. |
| Emoji Picker | emoji-picker-react | Frimousse | Newer library (2025), less battle-tested. Designed for Liveblocks integration which we don't use. |
| Mentions | BlockNote custom inline | react-mentions | BlockNote already integrated. Adding separate mention library creates two rich text systems. BlockNote's inline content is type-safe and serializes to message.body JSON. |
| Mentions | BlockNote custom inline | draft-js-mention-plugin | Draft.js is legacy (deprecated in favor of Lexical). BlockNote is actively maintained and already integrated. |
| Reply Threading | Inline (single-level) | Full threading (Stream Chat pattern) | Over-engineered for v0.9. Inline reply-to provides 80% of value with 20% of complexity. Can migrate schema to full threading later (just add threadId field). |

## What NOT to Use

| Library/Pattern | Why Avoid | Do Instead |
|-----------------|-----------|------------|
| Separate rich text editor for mentions | Duplication of editor stack. BlockNote handles inline content natively. | Use BlockNote's `createReactInlineContentSpec` pattern (already proven with taskMention, projectReference). |
| Emoji codes (:smile:, :thumbsup:) | Requires parsing library. Adds conversion layer. Native emoji works directly in React. | Store native emoji string in `messageReactions.emoji` field. |
| Client-side reaction aggregation | Race conditions in real-time updates. Multiple users reacting simultaneously causes UI glitches. | Query Convex with `by_message_emoji` index. Convex reactivity handles live count updates. |
| WebSocket library for reactions | Convex already provides real-time subscriptions. Adding ws/socket.io duplicates infrastructure. | Use Convex `useQuery` for live reaction counts. Updates propagate automatically. |
| Full threading library (react-chat-elements) | Brings opinionated chat UI components. Conflicts with existing BlockNote-based MessageRenderer. | Implement simple reply-to with schema field + QuotedMessage component. |

## Integration Points

### BlockNote Schema Extension

Current schema (MessageComposer.tsx line 40-47):
```typescript
const schema = BlockNoteSchema.create({
  blockSpecs: { ...remainingBlockSpecs },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    taskMention: TaskMention,         // existing
    projectReference: ProjectReference, // existing
    // ADD: userMention: UserMention
  },
});
```

**Validation:** Project already uses SuggestionMenuController with "#" trigger (line 247-310). Adding "@" trigger follows identical pattern.

### Convex Schema Extensions

Current tables:
- `messages` - add `replyToMessageId` field
- NEW `messageReactions` table

Indexes required:
- `messages.by_reply_to` - fetch replies
- `messageReactions.by_message_emoji` - count reactions
- `messageReactions.by_message_user` - uniqueness constraint

### Push Notification Integration

Project already has `pushSubscriptions` table (schema.ts line 204-215). Mention notifications leverage existing infrastructure:

```typescript
// convex/messages.ts mutation
if (mentionedUserIds.length > 0) {
  await ctx.scheduler.runAfter(0, internal.notifications.sendMentionNotifications, {
    messageId: newMessageId,
    mentionedUserIds,
    channelId,
  });
}
```

**Pattern precedent:** Task assignment notifications already implemented (per milestone context). Mention notifications follow same pattern.

## Version Compatibility

| Package | Current | Required | Notes |
|---------|---------|----------|-------|
| BlockNote | 0.46.2 | 0.46.x | Custom inline content API stable since 0.44. No breaking changes needed. |
| Convex | 1.31.7 | 1.31.x | Schema extensions backward compatible. Indexes can be added without migration. |
| Radix Popover | 1.1.15 | 1.1.x | No changes needed. |
| emoji-picker-react | - | ^4.17.4 | New dependency. React 18 compatible. |

## Bundle Size Impact

| Addition | Size (minified) | Size (gzipped) | Justification |
|----------|-----------------|----------------|---------------|
| emoji-picker-react | 2.59 MB | ~600 KB | Comparable to BlockNote (already loaded). Lazy load with React.lazy() if needed. |
| UserMention inline content | ~2 KB | ~1 KB | Minimal - follows TaskMention pattern. |
| Schema changes | 0 KB | 0 KB | Backend only. |

**Total impact:** ~600 KB gzipped for emoji picker. Mitigations:
- Lazy load: `const Picker = lazy(() => import('emoji-picker-react'))`
- Only loads when user opens reaction popover
- One-time cost amortized across all reactions

## Confidence Assessment

| Area | Confidence | Rationale |
|------|------------|-----------|
| BlockNote mentions | HIGH | Pattern already validated with taskMention and projectReference. SuggestionMenuController API documented and stable. |
| Emoji picker library | HIGH | emoji-picker-react actively maintained (published Feb 3, 2026 per npm). 7.8k GitHub stars, 234 dependent packages. |
| Reaction schema | HIGH | Convex official docs include reactions implementation guide. Pattern validated in production apps. |
| Reply-to threading | MEDIUM | Schema pattern straightforward (single optional field). UI complexity depends on quoted message rendering (needs design). |

## Sources

**Emoji Picker Research:**
- [emoji-picker-react npm](https://www.npmjs.com/package/emoji-picker-react) - Latest version 4.17.4
- [emoji-picker-react GitHub](https://github.com/ealush/emoji-picker-react) - Most popular React emoji picker
- [emoji-mart GitHub](https://github.com/missive/emoji-mart) - Alternative with modular data loading
- [React Emoji Picker Guide (Velt, Oct 2025)](https://velt.dev/blog/react-emoji-picker-guide) - Comparison and best practices
- [npm-compare: emoji-mart vs emoji-picker-react](https://npm-compare.com/emoji-mart,emoji-picker-react,react-emoji-render) - Bundle size analysis

**BlockNote Custom Inline Content:**
- [BlockNote Custom Inline Content docs](https://www.blocknotejs.org/docs/custom-schemas/custom-inline-content) - createReactInlineContentSpec API
- [BlockNote Mentions Menu example](https://www.blocknotejs.org/examples/custom-schema/suggestion-menus-mentions) - @ trigger autocomplete pattern
- [BlockNote Suggestion Menus docs](https://www.blocknotejs.org/docs/react/components/suggestion-menus) - SuggestionMenuController

**Convex Reactions:**
- [Convex: Likes, Upvotes & Reactions](https://www.convex.dev/can-do/likes-and-reactions) - Official implementation guide
- [Convex Schemas](https://docs.convex.dev/database/schemas) - defineTable and index patterns

**Chat Threading Patterns:**
- [Stream Chat React Threads docs](https://getstream.io/chat/docs/react/threads/) - parent_id threading pattern
- [Sendbird Quote Reply](https://sendbird.com/docs/chat/uikit/v3/react/features/message-threading/quote-reply) - Inline reply-to implementation

**Slack Engineering:**
- [Rebuilding Slack's Emoji Picker in React](https://slack.engineering/rebuilding-slacks-emoji-picker-in-react/) - React-virtualized for performance, component architecture

**Community Resources:**
- [Building an Emoji Picker with React (Jan 2026)](https://jafmah97.medium.com/building-an-emoji-picker-with-react-66f612a43d67) - Provider pattern best practices
- [react-emoji-react GitHub](https://github.com/conorhastings/react-emoji-react) - Slack-style reaction UI clone
