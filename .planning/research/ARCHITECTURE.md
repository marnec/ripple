# Architecture Research: Chat Enhancements
**Domain:** Real-time chat messaging with @mentions, emoji reactions, and reply-to threading
**Researched:** 2026-02-07
**Confidence:** HIGH

## Executive Summary

This research covers integrating three social messaging features (@user mentions, emoji reactions, inline reply-to) into Ripple's existing Convex + BlockNote chat architecture. All three features follow established patterns in the codebase and have clear implementation paths with minimal architectural risk.

**Key finding:** All features can be implemented incrementally without breaking changes to existing chat functionality. The codebase already demonstrates the necessary patterns (custom inline content, mention detection, real-time updates, push notifications).

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (React)                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  MessageComposer (BlockNote)                                    │
│  ├─ Custom inline content specs:                               │
│  │  ├─ taskMention (existing)                                  │
│  │  ├─ projectReference (existing)                             │
│  │  └─ userMention (NEW)                                       │
│  ├─ SuggestionMenuController:                                  │
│  │  ├─ # trigger → tasks/projects (existing)                   │
│  │  └─ @ trigger → users (NEW)                                 │
│  └─ Submit → JSON body + plainText                             │
│                                                                 │
│  Message Component                                              │
│  ├─ MessageRenderer (BlockNote JSON → React)                   │
│  ├─ Context menu (edit, delete, create task)                   │
│  ├─ ReactionBar (NEW)                                           │
│  │  ├─ Reaction picker button                                  │
│  │  ├─ Aggregated reaction chips (emoji + count)               │
│  │  └─ Optimistic updates on click                             │
│  └─ Reply preview (NEW - if parentMessageId exists)            │
│                                                                 │
│  Chat View                                                      │
│  └─ Message list (paginated, newest first)                     │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                      CONVEX BACKEND                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  messages table (MODIFIED)                                      │
│  ├─ userId, body, plainText, channelId, deleted (existing)     │
│  └─ parentMessageId: optional Id<"messages"> (NEW)             │
│                                                                 │
│  messageReactions table (NEW - separate table approach)        │
│  ├─ messageId: Id<"messages">                                  │
│  ├─ userId: Id<"users">                                        │
│  ├─ emoji: string                                              │
│  └─ Indexes: by_message, by_message_emoji, by_user             │
│                                                                 │
│  Mutations                                                      │
│  ├─ messages.send (MODIFIED)                                   │
│  │  └─ Extract @mentions → schedule notifications             │
│  ├─ messageReactions.toggle (NEW)                              │
│  │  └─ Add/remove reaction with optimistic update support     │
│  └─ messages.update (MODIFIED)                                 │
│     └─ Diff mentions → notify newly added @mentions            │
│                                                                 │
│  Queries                                                        │
│  ├─ messages.list (MODIFIED - join reactions)                  │
│  │  └─ Return messages with aggregated reaction counts         │
│  ├─ messageReactions.byMessage (NEW)                           │
│  │  └─ Get all reactions for a message (grouped by emoji)     │
│  └─ messages.getWithParent (NEW)                               │
│     └─ Fetch message + parent preview for reply rendering      │
│                                                                 │
│  Push Notifications (existing pattern)                         │
│  └─ internal.chatNotifications.notifyUserMentions (NEW)        │
│     └─ Similar to taskNotifications.notifyUserMentions         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Integration Points |
|-----------|---------------|-------------------|
| **UserMention inline content (NEW)** | BlockNote custom inline content for @user mentions | - MessageComposer schema<br>- MessageRenderer rendering<br>- UserMentionChip component |
| **SuggestionMenuController @-trigger (NEW)** | Autocomplete menu for workspace users on @ key | - MessageComposer<br>- workspaceMembers query |
| **ReactionBar (NEW)** | Display and manage emoji reactions on messages | - Message component<br>- messageReactions.toggle mutation<br>- messageReactions.byMessage query |
| **ReplyPreview (NEW)** | Show parent message context for threaded replies | - Message component<br>- messages.getWithParent query |
| **UserMentionChip (NEW)** | Render @user mentions with live user data | - MessageRenderer InlineRenderer<br>- users API |
| **messages.send (MODIFIED)** | Extract @mentions from body, send notifications | - extractMentionedUserIds utility<br>- internal.chatNotifications |
| **messageReactions table (NEW)** | Store individual user reactions | - Separate table pattern<br>- Real-time subscriptions |

## Data Model Changes

### Modified Tables

#### messages table
```typescript
messages: defineTable({
  userId: v.id("users"),
  isomorphicId: v.string(),
  body: v.string(),              // BlockNote JSON (may contain userMention inline content)
  plainText: v.string(),
  channelId: v.id("channels"),
  deleted: v.boolean(),
  parentMessageId: v.optional(v.id("messages")), // NEW: for reply-to threading
})
  .index("by_channel", ["channelId"])
  .index("undeleted_by_channel", ["channelId", "deleted"])
  .index("by_parent_message", ["parentMessageId"]) // NEW: for thread queries
  .searchIndex("by_text", { searchField: "plainText", filterFields: ["channelId"] })
```

**Changes:**
- Add `parentMessageId` field (optional) for reply-to feature
- Add `by_parent_message` index for querying threaded replies

### New Tables

#### messageReactions table
```typescript
messageReactions: defineTable({
  messageId: v.id("messages"),
  userId: v.id("users"),
  emoji: v.string(), // Unicode emoji (e.g., "👍", "❤️", "🎉")
})
  .index("by_message", ["messageId"])
  .index("by_message_emoji", ["messageId", "emoji"])
  .index("by_user", ["userId"])
  .index("by_message_user", ["messageId", "userId"])
```

**Design rationale:**
- **Separate table vs embedded array:** Separate table chosen for real-time granularity and Convex best practices
- **Real-time updates:** Each reaction is a separate document → Convex subscriptions update only affected reactions
- **Aggregation:** Query by `by_message_emoji` index, group by emoji, count users
- **Toggle semantics:** Query `by_message_user` to check if user already reacted, then insert/delete

**Alternative considered:** Embedded array on messages table
```typescript
reactions: v.optional(v.array(v.object({
  userId: v.id("users"),
  emoji: v.string(),
})))
```
**Why rejected:**
- Entire message document updates on every reaction → triggers re-render of entire message
- No index support for array contents (can't query "messages with 👍")
- Harder to implement optimistic updates (must patch entire array)
- Poor scalability (popular messages with many reactions = large document)

### BlockNote JSON Schema Changes

#### UserMention inline content type (NEW)
```typescript
type InlineContent =
  | { type: "text"; ... }
  | { type: "link"; ... }
  | { type: "taskMention"; props: { taskId: string; taskTitle?: string } }
  | { type: "projectReference"; props: { projectId: string } }
  | { type: "userMention"; props: { userId: string } }  // NEW
```

Stored in `messages.body` JSON field, extracted via `extractMentionedUserIds` utility (existing pattern from task comments).

## Data Flow

### @User Mention Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. User types "@" in MessageComposer                        │
│    └─ SuggestionMenuController triggers                     │
│                                                              │
│ 2. Query workspace members for autocomplete                 │
│    └─ Filter by query text (name/email)                     │
│                                                              │
│ 3. User selects @Alice from menu                            │
│    └─ Insert { type: "userMention", props: { userId } }     │
│                                                              │
│ 4. Submit message                                            │
│    ├─ Serialize BlockNote JSON → body                       │
│    ├─ Extract plainText (without @mentions)                 │
│    └─ Call messages.send mutation                           │
│                                                              │
│ 5. messages.send mutation                                   │
│    ├─ Insert message document                               │
│    ├─ extractMentionedUserIds(body) → ["userId1", ...]     │
│    ├─ Filter out sender from mentioned list                 │
│    └─ Schedule internal.chatNotifications.notifyUserMentions│
│                                                              │
│ 6. Push notification sent to @mentioned users               │
│    └─ "Alice mentioned you in #general"                     │
│                                                              │
│ 7. MessageRenderer displays message                         │
│    └─ userMention → <UserMentionChip userId={userId} />    │
│       └─ Live query for user data (name, avatar)           │
└─────────────────────────────────────────────────────────────┘
```

**Key integration points:**
- Reuse existing `extractMentionedUserIds` utility from task comments (already handles BlockNote JSON traversal)
- Reuse existing push notification pattern from `taskNotifications.ts`
- Follow existing pattern from `TaskMention` and `ProjectReference` inline content specs

### Emoji Reaction Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. User hovers/clicks message → ReactionBar appears         │
│                                                              │
│ 2. User clicks emoji picker or existing reaction            │
│    └─ Optimistic update: immediately show/remove reaction   │
│                                                              │
│ 3. messageReactions.toggle mutation                         │
│    ├─ Check if reaction exists (by_message_user index)      │
│    ├─ If exists: delete reaction                            │
│    └─ If not: insert new reaction                           │
│                                                              │
│ 4. Convex real-time subscription updates                    │
│    └─ All clients viewing message see updated reactions     │
│                                                              │
│ 5. ReactionBar re-queries and aggregates                    │
│    ├─ Group reactions by emoji                              │
│    ├─ Count users per emoji                                 │
│    ├─ Highlight user's own reactions                        │
│    └─ Render: "👍 3  ❤️ 5  🎉 1"                            │
└─────────────────────────────────────────────────────────────┘
```

**Aggregation query example:**
```typescript
export const byMessage = query({
  args: { messageId: v.id("messages") },
  returns: v.any(),
  handler: async (ctx, { messageId }) => {
    const reactions = await ctx.db
      .query("messageReactions")
      .withIndex("by_message", (q) => q.eq("messageId", messageId))
      .collect();

    // Group by emoji, aggregate counts and user IDs
    const aggregated = new Map<string, { count: number; userIds: Id<"users">[] }>();
    for (const r of reactions) {
      const existing = aggregated.get(r.emoji) ?? { count: 0, userIds: [] };
      existing.count++;
      existing.userIds.push(r.userId);
      aggregated.set(r.emoji, existing);
    }

    return Array.from(aggregated.entries()).map(([emoji, data]) => ({
      emoji,
      count: data.count,
      userIds: data.userIds,
    }));
  },
});
```

**Optimistic update pattern:**
```typescript
const toggleReaction = useMutation(api.messageReactions.toggle);

const handleReactionClick = (emoji: string) => {
  toggleReaction({
    messageId,
    emoji
  }, {
    optimisticUpdate: (localQueryStore) => {
      // Immediately update local cache before server confirms
      // Convex rolls back if mutation fails
    }
  });
};
```

### Reply-to Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. User right-clicks message → "Reply to message"           │
│    └─ Store parentMessageId in composer state               │
│                                                              │
│ 2. Composer shows reply preview                             │
│    ├─ Small preview card: author, snippet of parent body    │
│    └─ "X" button to cancel reply mode                       │
│                                                              │
│ 3. User types reply and submits                             │
│    └─ messages.send({ ..., parentMessageId })               │
│                                                              │
│ 4. MessageRenderer detects parentMessageId                  │
│    ├─ Query parent message                                  │
│    ├─ Render compact reply preview above message body       │
│    └─ Handle deleted parent gracefully                      │
│                                                              │
│ 5. Reply preview component                                  │
│    ├─ If parent exists: show author + snippet              │
│    ├─ If parent deleted: show "Original message deleted"    │
│    └─ Click preview → scroll to parent (if visible) or      │
│       open MessageContext view (existing search feature)    │
└─────────────────────────────────────────────────────────────┘
```

**Deleted parent message handling:**
```typescript
export const getWithParent = query({
  args: { messageId: v.id("messages") },
  returns: v.any(),
  handler: async (ctx, { messageId }) => {
    const message = await ctx.db.get(messageId);
    if (!message || message.deleted) return null;

    let parent = null;
    if (message.parentMessageId) {
      parent = await ctx.db.get(message.parentMessageId);
      // If deleted, return tombstone for graceful degradation
      if (parent?.deleted) {
        parent = { _id: parent._id, deleted: true };
      }
    }

    return { message, parent };
  },
});
```

**UI for deleted parent:**
```tsx
{parentMessageId && (
  <ReplyPreview>
    {parent?.deleted ? (
      <div className="text-muted-foreground italic">
        Original message deleted
      </div>
    ) : (
      <>
        <strong>{parent.author}</strong>
        <p className="truncate">{parent.plainText}</p>
      </>
    )}
  </ReplyPreview>
)}
```

## Architectural Patterns

### Pattern 1: Custom BlockNote Inline Content
**What:** Define new inline content types in BlockNote schema, render them as React components
**When:** Adding interactive elements within message text (@mentions, task links, etc.)
**Example:**
```typescript
// Define spec
export const UserMention = createReactInlineContentSpec(
  {
    type: "userMention",
    propSchema: { userId: { default: "" } },
    content: "none",
  },
  {
    render: ({ inlineContent }) => (
      <UserMentionChip userId={inlineContent.props.userId} />
    ),
  }
);

// Add to schema
const schema = BlockNoteSchema.create({
  blockSpecs: { ...defaultBlockSpecs },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    userMention: UserMention, // NEW
  },
});
```

**Existing examples:** `TaskMention`, `ProjectReference`

### Pattern 2: SuggestionMenuController for Autocomplete
**What:** BlockNote's built-in autocomplete triggered by special characters
**When:** User types trigger character (# for tasks, @ for mentions)
**Example:**
```typescript
<SuggestionMenuController
  triggerCharacter={"@"}
  getItems={async (query) => {
    const members = await queryWorkspaceMembers({ workspaceId });
    return members
      .filter((m) => m.name.toLowerCase().includes(query.toLowerCase()))
      .map((m) => ({
        title: m.name,
        onItemClick: () => {
          editor.insertInlineContent([
            { type: "userMention", props: { userId: m._id } },
            " ",
          ]);
        },
      }));
  }}
/>
```

**Existing example:** MessageComposer # trigger for tasks/projects

### Pattern 3: Mention Extraction and Diff-based Notifications
**What:** Parse BlockNote JSON to extract mention IDs, diff old vs new for edit notifications
**When:** Sending or editing messages with @mentions
**Example:**
```typescript
// In messages.send mutation
const mentionedUserIds = extractMentionedUserIds(body);
const filteredMentions = mentionedUserIds.filter(id => id !== userId);

if (filteredMentions.length > 0) {
  await ctx.scheduler.runAfter(0, internal.chatNotifications.notifyUserMentions, {
    messageId,
    mentionedUserIds: filteredMentions,
    mentionedBy: { name: user.name, id: userId },
  });
}
```

**Existing example:** `taskComments.create` and `taskComments.update` mutations

### Pattern 4: Separate Table for Many-to-Many Relationships
**What:** Store reactions as individual documents in a join table
**When:** Many users can react with many emojis to many messages
**Why:**
- Real-time granularity (only changed reaction updates, not entire message)
- Indexable and queryable (find all messages with 🎉 emoji)
- Scalable (no document size limits)

**Example:** messageReactions table with indexes for efficient aggregation

**Convex best practice:** Documented in [Relationship Structures: Let's Talk About Schemas](https://stack.convex.dev/relationship-structures-let-s-talk-about-schemas) and [Likes, Upvotes & Reactions: Convex can do that](https://www.convex.dev/can-do/likes-and-reactions)

### Pattern 5: Optimistic Updates for Instant Feedback
**What:** Update local UI immediately, rollback if mutation fails
**When:** User interactions that should feel instant (reactions, typing indicators)
**Example:**
```typescript
const toggleReaction = useMutation(api.messageReactions.toggle, {
  optimisticUpdate: (localQueryStore, args) => {
    const currentReactions = localQueryStore.getQuery(
      api.messageReactions.byMessage,
      { messageId: args.messageId }
    );
    // Modify local cache immediately
  }
});
```

**Existing pattern:** Convex optimistic updates are used in other parts of app
**Documentation:** [Optimistic Updates | Convex Developer Hub](https://docs.convex.dev/client/react/optimistic-updates)

## Anti-Patterns to Avoid

### Anti-Pattern 1: Embedding Reactions Array in Messages
**What:** Store reactions as `reactions: v.array(v.object({ userId, emoji }))`
**Why bad:**
- Updates entire message document on every reaction
- All message subscribers re-render (not just reaction bar)
- No indexes on array contents (can't query "messages with 👍")
- Document size limits for viral messages
**Instead:** Use separate `messageReactions` table with indexes

### Anti-Pattern 2: Querying All Users for @Mention Autocomplete
**What:** Query all platform users, filter client-side
**Why bad:**
- Wasted bandwidth for large platforms
- Slow autocomplete UX
- Can leak user information across workspaces
**Instead:** Query `workspaceMembers` table with workspace filter, limit results

### Anti-Pattern 3: Fetching Parent Message on Every Render
**What:** Call `messages.get(parentMessageId)` in message component render
**Why bad:**
- N+1 query problem for threaded conversations
- Redundant queries for same parent
**Instead:**
- Join parent data in `messages.list` query (batch fetch)
- Use Convex's automatic query memoization
- OR fetch parent only on-demand (expand thread UI)

### Anti-Pattern 4: Cascading Deletes for Threaded Messages
**What:** Delete all replies when parent message is deleted
**Why bad:**
- Loses conversation context
- Violates user expectation (their reply still has value)
- Increases mutation complexity
**Instead:** Keep replies, show tombstone for deleted parent

### Anti-Pattern 5: Storing Plaintext Mention List Separately
**What:** Add `mentionedUserIds: v.array(v.id("users"))` field on messages
**Why bad:**
- Duplicates data (already in BlockNote JSON body)
- Can drift out of sync with body
- Extra storage cost
**Instead:** Extract mentions on-demand from body via `extractMentionedUserIds`

### Anti-Pattern 6: Creating New Notification Action Per Feature
**What:** Copy-paste push notification code for each notification type
**Why bad:**
- Code duplication
- Harder to change notification provider
- Inconsistent VAPID setup
**Instead:** Create shared notification helper, pass template parameters

## Integration Points

### Integration Point 1: MessageComposer Schema
**Current state:**
```typescript
const schema = BlockNoteSchema.create({
  blockSpecs: { ...defaultBlockSpecs },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    taskMention: TaskMention,
    projectReference: ProjectReference,
  },
});
```

**Required change:**
```typescript
inlineContentSpecs: {
  ...defaultInlineContentSpecs,
  taskMention: TaskMention,
  projectReference: ProjectReference,
  userMention: UserMention, // ADD THIS
},
```

**Files affected:**
- `src/pages/App/Chat/MessageComposer.tsx`
- `src/pages/App/Chat/CustomInlineContent/UserMention.tsx` (NEW)

### Integration Point 2: MessageRenderer Inline Content Types
**Current state:** Handles `text`, `link`, `taskMention`, `projectReference`

**Required change:** Add case for `userMention` type
```typescript
function InlineRenderer({ content }: { content: InlineContent }) {
  switch (content.type) {
    case "text": return <StyledText ... />;
    case "link": return <a ... />;
    case "taskMention": return <TaskMentionChip ... />;
    case "projectReference": return <ProjectReferenceChip ... />;
    case "userMention": return <UserMentionChip userId={content.props.userId} />; // ADD
    default: return null;
  }
}
```

**Files affected:**
- `src/pages/App/Chat/MessageRenderer.tsx`
- `src/pages/App/Chat/UserMentionChip.tsx` (NEW)

### Integration Point 3: messages.send Mutation
**Current state:**
```typescript
export const send = mutation({
  handler: async (ctx, { body, channelId, plainText, isomorphicId }) => {
    // Insert message
    await ctx.db.insert("messages", { ... });

    // Send channel push notification (existing)
    await ctx.scheduler.runAfter(0, api.pushNotifications.sendPushNotification, { ... });
  },
});
```

**Required change:**
```typescript
handler: async (ctx, { body, channelId, plainText, isomorphicId, parentMessageId }) => {
  // Insert message (add parentMessageId)
  await ctx.db.insert("messages", {
    ...,
    parentMessageId: parentMessageId ?? undefined
  });

  // Send channel push notification (existing)
  await ctx.scheduler.runAfter(0, api.pushNotifications.sendPushNotification, { ... });

  // Send @mention notifications (NEW)
  const mentionedUserIds = extractMentionedUserIds(body);
  const filteredMentions = mentionedUserIds.filter(id => id !== userId);
  if (filteredMentions.length > 0) {
    const user = await ctx.db.get(userId);
    await ctx.scheduler.runAfter(0, internal.chatNotifications.notifyUserMentions, {
      messageId: insertedMessageId,
      mentionedUserIds: filteredMentions,
      mentionedBy: { name: user?.name ?? "Someone", id: userId },
      channelId,
    });
  }
}
```

**Files affected:**
- `convex/messages.ts`
- `convex/chatNotifications.ts` (NEW - internal action)
- `convex/utils/blocknote.ts` (already exists, reuse `extractMentionedUserIds`)

### Integration Point 4: Message Component
**Current state:** Renders message body, context menu (edit/delete/create task)

**Required additions:**
```typescript
export function Message({ message, ... }: MessageProps) {
  // ... existing code ...

  return (
    <li>
      <MessageRenderer blocks={blocks} />

      {/* NEW: Reply preview */}
      {message.parentMessageId && (
        <ReplyPreview parentMessageId={message.parentMessageId} />
      )}

      {/* NEW: Reaction bar */}
      <ReactionBar messageId={message._id} />

      {/* Existing context menu */}
      <ContextMenu>
        <ContextMenuItem onClick={handleEdit}>Edit</ContextMenuItem>
        <ContextMenuItem onClick={handleDelete}>Delete</ContextMenuItem>
        <ContextMenuItem onClick={handleCreateTask}>Create task</ContextMenuItem>
        <ContextMenuItem onClick={handleReply}>Reply to message</ContextMenuItem> {/* NEW */}
      </ContextMenu>
    </li>
  );
}
```

**Files affected:**
- `src/pages/App/Chat/Message.tsx`
- `src/pages/App/Chat/ReactionBar.tsx` (NEW)
- `src/pages/App/Chat/ReplyPreview.tsx` (NEW)

### Integration Point 5: Schema and Indexes
**Current state:** `convex/schema.ts` has messages table

**Required changes:**
```typescript
messages: defineTable({
  // ... existing fields ...
  parentMessageId: v.optional(v.id("messages")), // ADD
})
  .index("by_channel", ["channelId"])
  .index("undeleted_by_channel", ["channelId", "deleted"])
  .index("by_parent_message", ["parentMessageId"]) // ADD
  .searchIndex("by_text", { searchField: "plainText", filterFields: ["channelId"] }),

messageReactions: defineTable({ // NEW TABLE
  messageId: v.id("messages"),
  userId: v.id("users"),
  emoji: v.string(),
})
  .index("by_message", ["messageId"])
  .index("by_message_emoji", ["messageId", "emoji"])
  .index("by_user", ["userId"])
  .index("by_message_user", ["messageId", "userId"]),
```

**Files affected:**
- `convex/schema.ts`

## Component Dependency Graph

```
Phase 1: @User Mentions
├─ UserMention inline content spec
├─ UserMentionChip component
├─ MessageComposer @ trigger
├─ MessageRenderer userMention case
├─ extractMentionedUserIds (reuse from tasks)
├─ messages.send mention detection
├─ chatNotifications.notifyUserMentions (internal action)
└─ Push notification delivery

Phase 2: Emoji Reactions
├─ messageReactions table + indexes
├─ messageReactions.toggle mutation
├─ messageReactions.byMessage query
├─ ReactionBar component
├─ Reaction picker UI
├─ Optimistic update logic
└─ messages.list aggregation join (optional)

Phase 3: Reply-to Threading
├─ messages.parentMessageId field + index
├─ messages.send parentMessageId parameter
├─ messages.getWithParent query
├─ ReplyPreview component
├─ Message context menu "Reply" action
├─ MessageComposer reply mode state
└─ Deleted parent tombstone handling
```

**Build order rationale:**
1. **Phase 1 (@mentions) first:** Reuses most existing patterns (inline content, mention extraction, push notifications)
2. **Phase 2 (reactions) second:** New data model pattern but self-contained, no dependencies on mentions
3. **Phase 3 (reply-to) last:** UI integration with phases 1-2 (reply + mention, reply + react)

## Sources

- [Slack Architecture - System Design](https://systemdesign.one/slack-architecture/)
- [Slack Engineering: Rebuilding Emoji Picker in React](https://slack.engineering/rebuilding-slacks-emoji-picker-in-react/)
- [Slack API: reactions.add method](https://docs.slack.dev/reference/methods/reactions.add/)
- [Discord Message Reactions](https://discordjs.guide/popular-topics/reactions)
- [Convex: Likes, Upvotes & Reactions](https://www.convex.dev/can-do/likes-and-reactions)
- [Convex: Relationship Structures](https://stack.convex.dev/relationship-structures-let-s-talk-about-schemas)
- [Convex: Optimistic Updates](https://docs.convex.dev/client/react/optimistic-updates)
- [Convex: Real-Time Database Guide](https://stack.convex.dev/real-time-database)
- [BlockNote: Custom Inline Content](https://www.blocknotejs.org/docs/custom-schemas/custom-inline-content)
- [BlockNote: Mentions Menu](https://www.blocknotejs.org/examples/custom-schema/suggestion-menus-mentions)
- [Slack: Message Threading](https://api.slack.com/docs/message-threading)
- [Email Threading: In-Reply-To and References](https://cr.yp.to/immhf/thread.html)
