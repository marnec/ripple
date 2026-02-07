# Phase 10: Inline Reply-To - Research

**Researched:** 2026-02-07
**Domain:** Inline message reply with quoted previews, graceful deleted message handling
**Confidence:** HIGH

## Summary

Phase 10 implements inline reply-to functionality for chat messages, enabling users to reply to specific messages with a quoted preview. Unlike threaded replies (Slack-style sidebar threads), inline replies keep the conversation flow in the main channel while showing context through compact quote previews. This is the modern chat direction - Google Chat fully migrated to inline threading in 2025, and Discord has refined its inline reply UI with accessibility improvements.

**Key architectural insights:**
- Ripple's chat already has composer state management (ChatContext with editingMessage pattern)
- Schema extension: Add optional `replyToId` field to messages table (nullable, references messages)
- UI pattern: Quote preview in composer during reply mode, compact preview above sent replies
- Deleted message handling: Soft delete already implemented - just render "[Message deleted]" when parent is deleted

**Industry trend (2025-2026):** Major platforms consolidated on inline threading vs sidebar threads. [Google rolled out inline threading to all conversations](https://workspaceupdates.googleblog.com/2025/11/inline-threading-direct-messages-google-chat.html) in Nov 2025, citing superior organization at scale. Discord improved reply accessibility in [Feb 2026 patch notes](https://discord.com/blog/discord-patch-notes-february-4-2026).

**Primary recommendation:** Extend messages schema with nullable `replyToId` field. Add reply mode to ChatContext (similar to editingMessage). Render compact quote preview in composer and above sent replies. Leverage existing soft delete (messages.deleted) for graceful "[Message deleted]" fallback.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React Context | 18.x | Reply mode state | Already used for editingMessage, consistent pattern |
| Convex | 1.31.7 | Nullable foreign keys | Native support for optional v.id() references |
| @blocknote/react | 0.46.2 | Composer UI | Already integrated, no new dependencies |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @radix-ui/react-context-menu | Built-in | "Reply" action trigger | Already used in Message.tsx for Edit/Delete |
| lucide-react | 0.563.0 | Reply icon (CornerUpLeft) | UI affordance for reply action |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Inline replies | Threaded replies (Slack-style) | Explicitly rejected per requirements - inline is simpler, matches industry trend |
| Nullable replyToId | Separate replies table | Over-engineered - messages ARE replies, just with optional parent |
| Quote preview in composer | No preview | Poor UX - user forgets what they're replying to |

**Installation:**
```bash
# No new dependencies - all infrastructure exists
```

## Architecture Patterns

### Current Chat State Management
```
ChatContext (already exists):
- editingMessage: { id: Id<"messages"> | null, body: string | null }
- setEditingMessage: (msg) => void

Chat.tsx handles:
- MessageComposer submission (create vs edit)
- Message list rendering
- Context menu actions via Message component
```

### Pattern 1: Extending Messages Schema with Optional Parent
**What:** Add nullable `replyToId` field to messages table for parent message reference
**When to use:** When replies and regular messages are the same entity type (inline model)
**Example:**
```typescript
// Source: convex/schema.ts + industry best practices
// Following Twitter/Discord model: replies ARE messages with optional parent

messages: defineTable({
  userId: v.id("users"),
  isomorphicId: v.string(),
  body: v.string(),
  plainText: v.string(),
  channelId: v.id("channels"),
  deleted: v.boolean(),
  replyToId: v.optional(v.id("messages")), // ADDED - nullable parent reference
})
  .index("by_channel", ["channelId"])
  .index("undeleted_by_channel", ["channelId", "deleted"])
  .index("by_reply_to", ["replyToId"]) // ADDED - for querying replies to a message
  .searchIndex("by_text", { searchField: "plainText", filterFields: ["channelId"] }),
```

**Why this works:** [Industry consensus](https://dev.to/echoeyecodes/replies-are-well-comments-too-4639) treats replies as the same entity as messages, distinguished by whether they reference a parent. This avoids schema complexity while enabling parent-child queries. Nullable fields are [standard for soft delete patterns](https://www.geeksforgeeks.org/dbms/difference-between-soft-delete-and-hard-delete/) where parent can be null.

### Pattern 2: Reply Mode in ChatContext
**What:** Extend existing ChatContext to track reply mode alongside edit mode
**When to use:** When composer needs additional state beyond message creation/editing
**Example:**
```typescript
// Source: Adapted from existing ChatContext.ts pattern
// BEFORE (current):
export type EditingMessage = { body: string | null; id: Id<"messages"> | null };
type EditingMessageContext = {
  editingMessage: EditingMessage;
  setEditingMessage: (msg: EditingMessage) => void;
};

// AFTER (with reply mode):
export type EditingMessage = { body: string | null; id: Id<"messages"> | null };
export type ReplyingToMessage = {
  id: Id<"messages">;
  author: string;
  plainText: string;
} | null;

type ChatContextType = {
  editingMessage: EditingMessage;
  setEditingMessage: (msg: EditingMessage) => void;
  replyingTo: ReplyingToMessage; // ADDED
  setReplyingTo: (msg: ReplyingToMessage) => void; // ADDED
};
```

**Mutual exclusivity:** Reply mode and edit mode are mutually exclusive. When entering reply mode, clear edit mode and vice versa. Prevents confusing UX where user tries to edit AND reply simultaneously.

### Pattern 3: Compact Quote Preview Component
**What:** Reusable component showing compact message preview (author + truncated text)
**When to use:** Both in composer (reply mode) and in message display (above replies)
**Example:**
```tsx
// Source: Discord/Telegram inline reply UI patterns
// NEW FILE: MessageQuotePreview.tsx

type MessageQuotePreviewProps = {
  message: {
    author: string;
    plainText: string;
    deleted: boolean;
  } | null; // null when parent message not found
  onCancel?: () => void; // Only in composer
  compact?: boolean; // Smaller variant for sent replies
};

export function MessageQuotePreview({ message, onCancel, compact = false }: Props) {
  if (!message) {
    return (
      <div className="text-sm text-muted-foreground italic">
        [Original message not found]
      </div>
    );
  }

  if (message.deleted) {
    return (
      <div className="text-sm text-muted-foreground italic">
        [Message deleted]
      </div>
    );
  }

  const truncatedText = message.plainText.length > 100
    ? message.plainText.slice(0, 100) + "..."
    : message.plainText;

  return (
    <div className={cn(
      "flex items-start gap-2 px-3 py-2 bg-muted/50 rounded-md border-l-2 border-primary",
      compact && "py-1 text-sm"
    )}>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-xs text-muted-foreground">
          {message.author}
        </div>
        <div className="text-sm truncate">
          {truncatedText}
        </div>
      </div>
      {onCancel && (
        <Button variant="ghost" size="sm" onClick={onCancel}>
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
```

### Pattern 4: Reply Action in Context Menu
**What:** Add "Reply" option to existing message context menu
**When to use:** Triggering reply mode from any message
**Example:**
```tsx
// Source: src/pages/App/Chat/Message.tsx (existing pattern)
// In Message component, add to existing context menu

import { CornerUpLeft } from "lucide-react";

<ContextMenuContent>
  {/* Existing items */}
  {userIsAuthor && (
    <>
      <ContextMenuItem onClick={handleEdit}>Edit</ContextMenuItem>
      <ContextMenuItem onClick={handleDelete}>Delete</ContextMenuItem>
    </>
  )}
  {/* NEW: Reply action for all messages */}
  <ContextMenuItem onClick={handleReply}>
    <CornerUpLeft className="mr-2 h-4 w-4" />
    Reply
  </ContextMenuItem>
  <ContextMenuItem onClick={handleCreateTask}>Create task from message</ContextMenuItem>
</ContextMenuContent>
```

### Pattern 5: Conditional Message Submission Logic
**What:** Detect reply mode and include replyToId when sending message
**When to use:** MessageComposer submission flow
**Example:**
```tsx
// Source: Chat.tsx handleSubmit pattern
const handleSubmit = async (body: string, plainText: string) => {
  if (editingMessage.id) {
    // Existing edit flow
    await editMessage({ id: editingMessage.id, body, plainText });
    setEditingMessage({ id: null, body: null });
  } else {
    const isomorphicId = crypto.randomUUID();

    // MODIFIED: Include replyToId if in reply mode
    await sendMessage({
      body,
      plainText,
      channelId,
      isomorphicId,
      replyToId: replyingTo?.id ?? undefined, // ADDED
    });

    // Clear reply mode after sending
    if (replyingTo) {
      setReplyingTo(null);
    }
  }
};
```

### Pattern 6: Graceful Deleted Message Rendering
**What:** Query parent message, render "[Message deleted]" if deleted flag is true
**When to use:** Displaying replies with potentially deleted parents
**Example:**
```typescript
// Source: Industry pattern from Discord/Slack
// In messages.list query (convex/messages.ts), optionally enrich with parent

export const list = query({
  // ... existing args/returns
  handler: async (ctx, { channelId, paginationOpts }) => {
    // ... existing auth/query logic

    // Enrich messages with parent info for replies
    const messagesWithParent = await Promise.all(
      messagesWithAuthor.map(async (msg) => {
        if (!msg.replyToId) {
          return { ...msg, replyTo: null };
        }

        const parent = await ctx.db.get(msg.replyToId);
        if (!parent) {
          return { ...msg, replyTo: null }; // Parent not found
        }

        const parentUser = userMap.get(parent.userId);
        return {
          ...msg,
          replyTo: {
            author: parentUser?.name ?? "Unknown",
            plainText: parent.plainText,
            deleted: parent.deleted,
          }
        };
      })
    );

    return { ...messagesPage, page: messagesWithParent };
  },
});
```

### Anti-Patterns to Avoid
- **Separate replies table:** Over-engineered - replies ARE messages with optional parent
- **Storing full parent message in reply:** Data duplication - just store replyToId reference
- **Hard delete messages:** Breaks reply references - use existing soft delete
- **Nesting replies:** Explicitly out of scope - inline model avoids complexity
- **Reply mode + edit mode simultaneously:** Confusing UX - make them mutually exclusive

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Parent message fetch | N+1 query per message with reply | Batch query in messages.list | Performance - single query vs N queries |
| Truncating preview text | Custom string slicing with word boundaries | Simple `.slice(0, 100) + "..."` | Requirements say "truncated text" not "smart truncation" |
| Reply mode state | New state management library | Extend existing ChatContext | Consistent with editingMessage pattern |
| Message soft delete | Custom deletion logic | Existing messages.deleted field | Already implemented in Phase 08/09 |
| Quote preview styling | Custom CSS from scratch | Tailwind border-l-2 + bg-muted pattern | Standard quote visual language |

**Key insight:** Ripple already has 90% of infrastructure needed. ChatContext pattern exists, soft delete exists, MessageComposer handles conditional submission. This is primarily UI work, not architectural work.

## Common Pitfalls

### Pitfall 1: Circular Reply References
**What goes wrong:** User tries to reply to their own reply, creating potential loops
**Why it happens:** No validation preventing message from replying to itself or its descendants
**How to avoid:** For v1, simpler approach: allow any reply target. Requirements explicitly state no nested replies, so UI prevents reply-to-reply at display level (don't show Reply action on messages that already have replyToId)
**Warning signs:** Confusing UI where replies have reply previews that have reply previews

### Pitfall 2: Reply Mode + Edit Mode Conflict
**What goes wrong:** User clicks Edit on one message while replying to another
**Why it happens:** ChatContext allows both editingMessage and replyingTo to be set simultaneously
**How to avoid:**
```typescript
// Clear reply mode when entering edit mode
const handleEdit = () => {
  setReplyingTo(null); // IMPORTANT
  setEditingMessage({ id: message._id, body: message.body });
};

// Clear edit mode when entering reply mode
const handleReply = () => {
  setEditingMessage({ id: null, body: null }); // IMPORTANT
  setReplyingTo({ id: message._id, author: message.author, plainText: message.plainText });
};
```
**Warning signs:** Composer shows both reply preview and edit content simultaneously

### Pitfall 3: Missing Parent Message in Query
**What goes wrong:** Reply displays without quote preview, no error shown
**Why it happens:** Parent message deleted but query doesn't fetch parent info
**How to avoid:** Always enrich messages with parent info in messages.list query. Render "[Message deleted]" when parent.deleted is true, "[Original message not found]" when parent is null
**Warning signs:** Blank space where quote preview should be, no visual indication of reply

### Pitfall 4: Reply Action on Replies (Nested Replies)
**What goes wrong:** Users can reply to replies, creating nested chains
**Why it happens:** Context menu shows Reply action on ALL messages, including those with replyToId
**How to avoid:**
```typescript
// In Message.tsx context menu
{!message.replyToId && ( // IMPORTANT: Only show reply action if NOT already a reply
  <ContextMenuItem onClick={handleReply}>Reply</ContextMenuItem>
)}
```
**Warning signs:** Requirements explicitly state "no nested reply depth" but UI allows reply-to-reply

### Pitfall 5: Quote Preview Performance with Long Messages
**What goes wrong:** Quote preview rendering causes layout shift or slow performance
**Why it happens:** Parent message body is full BlockNote JSON, parsing on every render
**How to avoid:** Use plainText field for preview (already extracted), limit to 100 chars. Don't parse BlockNote JSON for quote preview
**Warning signs:** Quote preview shows complex formatting, parsing BlockNote on every message render

### Pitfall 6: Reply Mode Persists After Sending
**What goes wrong:** After sending reply, composer still shows quote preview
**Why it happens:** Forgetting to clear replyingTo state in handleSubmit
**How to avoid:** Always clear replyingTo after successful message send (see Pattern 5)
**Warning signs:** User sends reply, new message appears, but composer still shows quote preview

### Pitfall 7: Deleted Parent Query Inefficiency
**What goes wrong:** Querying parent message for every reply, even when parent is deleted
**Why it happens:** Not batching parent queries or checking deleted flag
**How to avoid:** Batch-fetch all parent messages in single query, then map to replies:
```typescript
// Get unique parent IDs from replies
const parentIds = [...new Set(messages.filter(m => m.replyToId).map(m => m.replyToId!))];

// Batch fetch parents
const parents = await getAll(ctx.db, parentIds);
const parentMap = new Map(parents.map((p, i) => [parentIds[i], p]));

// Map to messages
messages.map(msg => {
  if (!msg.replyToId) return { ...msg, replyTo: null };
  const parent = parentMap.get(msg.replyToId);
  // ... rest of enrichment
});
```
**Warning signs:** Network tab shows N separate parent message queries instead of one batch query

## Code Examples

Verified patterns from official sources and existing codebase:

### Extend Messages Schema
```typescript
// Source: convex/schema.ts + industry patterns
messages: defineTable({
  userId: v.id("users"),
  isomorphicId: v.string(),
  body: v.string(),
  plainText: v.string(),
  channelId: v.id("channels"),
  deleted: v.boolean(),
  replyToId: v.optional(v.id("messages")), // ADDED - nullable parent reference
})
  .index("by_channel", ["channelId"])
  .index("undeleted_by_channel", ["channelId", "deleted"])
  .index("by_reply_to", ["replyToId"]) // ADDED - for future features (find all replies to a message)
  .searchIndex("by_text", { searchField: "plainText", filterFields: ["channelId"] }),
```

### Extend ChatContext for Reply Mode
```typescript
// Source: src/pages/App/Chat/ChatContext.ts
import { createContext, useContext } from "react";
import { ConvexError } from "convex/values";
import { Id } from "../../../../convex/_generated/dataModel";

export type EditingMessage = { body: string | null; id: Id<"messages"> | null };
export type ReplyingToMessage = {
  id: Id<"messages">;
  author: string;
  plainText: string;
} | null;

type ChatContextType = {
  editingMessage: EditingMessage;
  setEditingMessage: (msg: EditingMessage) => void;
  replyingTo: ReplyingToMessage;
  setReplyingTo: (msg: ReplyingToMessage) => void;
};

export const ChatContext = createContext<ChatContextType | null>(null);

export const useChatContext = () => {
  const context = useContext(ChatContext);
  if (!context) throw new ConvexError("useChatContext must be used within ChatProvider");
  return context;
};
```

### Add Reply Mode to Chat.tsx
```tsx
// Source: src/pages/App/Chat/Chat.tsx
import { useState } from "react";
import { ChatContext, type EditingMessage, type ReplyingToMessage } from "./ChatContext";

export function Chat({ channelId }: { channelId: Id<"channels"> }) {
  const [editingMessage, setEditingMessage] = useState<EditingMessage>({ id: null, body: null });
  const [replyingTo, setReplyingTo] = useState<ReplyingToMessage>(null); // ADDED

  // ... existing code

  return (
    <ChatContext.Provider value={{
      editingMessage,
      setEditingMessage,
      replyingTo,      // ADDED
      setReplyingTo,   // ADDED
    }}>
      {/* ... rest of component */}
    </ChatContext.Provider>
  );
}
```

### MessageComposer with Reply Preview
```tsx
// Source: src/pages/App/Chat/MessageComposer.tsx
import { useChatContext } from "./ChatContext";
import { MessageQuotePreview } from "./MessageQuotePreview";

export const MessageComposer: React.FC<MessageComposerProps> = ({
  handleSubmit,
  channelId,
  workspaceId,
}) => {
  const { editingMessage, replyingTo, setReplyingTo } = useChatContext(); // ADDED replyingTo

  // ... existing editor setup

  return (
    <div className="flex sm:flex-col flex-col-reverse p-2 max-w-full border-t">
      {/* NEW: Reply preview above toolbar */}
      {replyingTo && (
        <MessageQuotePreview
          message={{
            author: replyingTo.author,
            plainText: replyingTo.plainText,
            deleted: false, // Only non-deleted messages can be replied to
          }}
          onCancel={() => setReplyingTo(null)}
        />
      )}

      {/* Existing toolbar and editor */}
      <div className="flex justify-between items-start">
        {/* ... existing toolbar buttons */}
      </div>
      <div className="flex gap-2 py-4">
        {/* ... existing BlockNoteView */}
      </div>
    </div>
  );
};
```

### Update Message Send Mutation
```typescript
// Source: convex/messages.ts
export const send = mutation({
  args: {
    isomorphicId: v.string(),
    body: v.string(),
    plainText: v.string(),
    channelId: v.id("channels"),
    replyToId: v.optional(v.id("messages")), // ADDED
  },
  returns: v.null(),
  handler: async (ctx, { body, channelId, plainText, isomorphicId, replyToId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    // ... existing auth checks

    await ctx.db.insert("messages", {
      body,
      userId,
      channelId,
      plainText,
      isomorphicId,
      deleted: false,
      replyToId, // ADDED - can be undefined, Convex handles optional fields
    });

    // ... existing notification logic
  },
});
```

### Add Reply Action to Message Context Menu
```tsx
// Source: src/pages/App/Chat/Message.tsx
import { CornerUpLeft } from "lucide-react";
import { useChatContext } from "./ChatContext";

export function Message({ message, channelId, workspaceId, onTaskCreated }: MessageProps) {
  const { setEditingMessage, setReplyingTo } = useChatContext(); // ADDED setReplyingTo

  const handleReply = useCallback(() => {
    // Clear edit mode (mutually exclusive)
    setEditingMessage({ id: null, body: null });

    // Enter reply mode
    setReplyingTo({
      id: message._id,
      author: message.author,
      plainText: message.plainText,
    });
  }, [message, setEditingMessage, setReplyingTo]);

  return (
    <ContextMenuContent>
      {userIsAuthor && (
        <>
          <ContextMenuItem onClick={handleEdit}>Edit</ContextMenuItem>
          <ContextMenuItem onClick={handleDelete}>Delete</ContextMenuItem>
        </>
      )}
      {/* NEW: Reply action (exclude if already a reply to prevent nesting) */}
      {!message.replyToId && (
        <ContextMenuItem onClick={handleReply}>
          <CornerUpLeft className="mr-2 h-4 w-4" />
          Reply
        </ContextMenuItem>
      )}
      <ContextMenuItem onClick={handleCreateTask}>Create task from message</ContextMenuItem>
    </ContextMenuContent>
  );
}
```

### Enrich Messages Query with Parent Info
```typescript
// Source: convex/messages.ts - extend existing list query
import { getAll } from "convex-helpers/server/relationships";

export const list = query({
  args: { channelId: v.id("channels"), paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(v.object({
      _id: v.id("messages"),
      _creationTime: v.number(),
      userId: v.id("users"),
      isomorphicId: v.string(),
      body: v.string(),
      plainText: v.string(),
      channelId: v.id("channels"),
      deleted: v.boolean(),
      replyToId: v.optional(v.id("messages")), // ADDED
      author: v.string(),
      replyTo: v.union(
        v.null(),
        v.object({
          author: v.string(),
          plainText: v.string(),
          deleted: v.boolean(),
        })
      ), // ADDED
    })),
    isDone: v.boolean(),
    continueCursor: v.string(),
    splitCursor: v.optional(v.union(v.string(), v.null())),
    pageStatus: v.optional(v.union(v.literal("SplitRecommended"), v.literal("SplitRequired"), v.null())),
  }),
  handler: async (ctx, { channelId, paginationOpts }) => {
    // ... existing auth and query logic

    // After fetching messagesWithAuthor:

    // Batch-fetch parent messages for replies
    const parentIds = [...new Set(
      messagesWithAuthor
        .filter(m => m.replyToId)
        .map(m => m.replyToId!)
    )];

    const parents = parentIds.length > 0
      ? await getAll(ctx.db, parentIds)
      : [];
    const parentMap = new Map(parents.map((p, i) => [parentIds[i], p]));

    // Enrich with parent info
    const messagesWithParent = await Promise.all(
      messagesWithAuthor.map(async (msg) => {
        if (!msg.replyToId) {
          return { ...msg, replyTo: null };
        }

        const parent = parentMap.get(msg.replyToId);
        if (!parent) {
          return { ...msg, replyTo: null }; // Parent not found (deleted from DB?)
        }

        const parentUser = userMap.get(parent.userId);
        return {
          ...msg,
          replyTo: {
            author: parentUser?.name ?? parentUser?.email ?? "Unknown",
            plainText: parent.plainText,
            deleted: parent.deleted,
          },
        };
      })
    );

    return {
      ...messagesPage,
      page: messagesWithParent,
    };
  },
});
```

### Render Quote Preview Above Reply
```tsx
// Source: src/pages/App/Chat/Message.tsx
import { MessageQuotePreview } from "./MessageQuotePreview";

export function Message({ message, channelId, workspaceId, onTaskCreated }: MessageProps) {
  // ... existing code

  return (
    <li className="flex flex-col">
      {/* NEW: Show quote preview if this is a reply */}
      {message.replyTo && (
        <div className="mb-2">
          <MessageQuotePreview
            message={message.replyTo}
            compact={true}
          />
        </div>
      )}

      {/* Existing message content */}
      <div className="flex flex-col">
        <div className="flex items-center gap-3">
          <div className="mb-1 text-xs text-muted-foreground/70">
            {new Date(_creationTime).toLocaleTimeString(undefined, { timeStyle: 'short' })}
          </div>
          <div className="mb-1 text-sm font-medium">{author}</div>
        </div>

        <ContextMenuTrigger>
          <div className="rounded-xl bg-muted px-3 py-2 transition-all">
            <MessageRenderer blocks={blocks} />
          </div>
        </ContextMenuTrigger>

        <MessageReactions messageId={message._id} />
      </div>
    </li>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Threaded replies (Slack sidebar) | Inline replies | 2023-2025 | Google Chat deprecated threading Nov 2025, moved to inline model |
| Hard delete messages | Soft delete with graceful UI | ~2020+ | Preserves reply references, "[Message deleted]" pattern standard |
| Separate replies table | Same table with nullable parent | Current standard | Twitter/Discord model - simpler schema, natural parent-child |
| Full parent data in reply | Reference ID only | Current practice | Prevents data duplication, single source of truth |

**Deprecated/outdated:**
- **Slack-style threaded replies:** Google Chat migrated away in 2025, cited [inline threading as superior for organization](https://workspaceupdates.googleblog.com/2025/11/inline-threading-direct-messages-google-chat.html)
- **Hard-deleting messages with replies:** Breaks references, modern systems use soft delete

## Open Questions

### Question 1: Should replies trigger notifications?
**What we know:** Requirements don't mention reply notifications
**What's unclear:** Should replying to someone notify them (like @mention does)?
**Recommendation:** Not for v0.9. Reply is implicit context (visible in chat flow), @mention is explicit notification. If user wants to notify, they can @mention in the reply. Simpler for v1, revisit if users request.

### Question 2: Click quote preview to jump to original?
**What we know:** Requirements list REPLY-05 as v1.0+ (jump to and highlight original)
**What's unclear:** Should quote preview be clickable in v0.9?
**Recommendation:** Make quote preview visually distinct (border-l-2, bg-muted) but non-interactive for v0.9. REPLY-05 adds jump functionality in next version. Simpler implementation path.

### Question 3: Rich quote preview with mentions/chips?
**What we know:** Requirements list REPLY-06 as v1.0+ (preserve task mentions, project chips in preview)
**What's unclear:** Should v0.9 quote preview parse BlockNote JSON for rich content?
**Recommendation:** Use plainText for v0.9 preview (simple, fast). REPLY-06 adds rich preview in next version. Matches "compact quoted preview" requirement - plainText is inherently compact.

### Question 4: Prevent reply-to-deleted messages?
**What we know:** Requirements say gracefully handle deleted parents in sent replies
**What's unclear:** Should UI prevent replying to a deleted message?
**Recommendation:** Yes - add `&& !message.deleted` to reply action visibility. No value in replying to deleted message. Soft delete is already checked in context menu rendering.

## Sources

### Primary (HIGH confidence)
- Existing codebase: `src/pages/App/Chat/Message.tsx` - Context menu pattern, message rendering
- Existing codebase: `src/pages/App/Chat/ChatContext.ts` - editingMessage state pattern
- Existing codebase: `src/pages/App/Chat/MessageComposer.tsx` - Composer UI and submission
- Existing codebase: `convex/messages.ts` - Message mutations and queries
- Existing codebase: `convex/schema.ts` - Messages table with soft delete
- [Google Workspace: Inline Threading](https://workspaceupdates.googleblog.com/2025/11/inline-threading-direct-messages-google-chat.html) - Industry direction
- [Discord Patch Notes Feb 2026](https://discord.com/blog/discord-patch-notes-february-4-2026) - Reply accessibility improvements
- [Database Model for Messaging Systems](https://www.red-gate.com/blog/database-model-for-a-messaging-system) - Reply schema patterns

### Secondary (MEDIUM confidence)
- [DEV: Replies are Comments Too](https://dev.to/echoeyecodes/replies-are-well-comments-too-4639) - Same-entity pattern for replies
- [GeeksforGeeks: Soft Delete vs Hard Delete](https://www.geeksforgeeks.org/dbms/difference-between-soft-delete-and-hard-delete/) - Deleted message handling
- [How to Design Database for Messaging](https://www.geeksforgeeks.org/dbms/how-to-design-a-database-for-messaging-systems/) - Parent-child patterns
- [Chat UX Best Practices](https://getstream.io/blog/chat-ux/) - General chat patterns
- [React Chat Threading Docs](https://getstream.io/chat/docs/react/threads/) - Thread implementation patterns

### Tertiary (LOW confidence)
- WebSearch: "inline reply vs threaded reply" - General UX discussion, not technical depth
- WebSearch: "Discord quote preview UI" - Community discussions, not official docs

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new libraries, all using existing Convex/React/Radix patterns
- Architecture: HIGH - ChatContext pattern proven in codebase, messages schema follows industry standards
- Pitfalls: HIGH - Based on existing editingMessage pattern and soft delete experience
- Industry trends: HIGH - Google/Discord official announcements from 2025-2026

**Research date:** 2026-02-07
**Valid until:** 60 days (mature domain - chat reply patterns are stable, though industry is actively consolidating on inline model)
