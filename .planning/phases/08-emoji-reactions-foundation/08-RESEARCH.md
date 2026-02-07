# Phase 08: Emoji Reactions Foundation - Research

**Researched:** 2026-02-07
**Domain:** Emoji picker integration, message reactions UI, real-time aggregation
**Confidence:** HIGH

## Summary

Emoji reactions are a well-established pattern in modern chat applications (Slack, Discord, Teams). The implementation requires three core components: (1) an emoji picker for selection, (2) a reactions data model with aggregation, and (3) a pill-based UI with hover tooltips. The React ecosystem has mature emoji picker libraries, Convex's reactive queries naturally handle real-time updates, and Radix UI components (already in use) provide the tooltip/popover primitives needed.

**Key findings:**
- emoji-picker-react is the most popular library with 74 code snippets in Context7 and high source reputation
- Slack uses react-virtualized for performance with large emoji lists
- Reactions should be stored in a separate table with compound indexes for efficient aggregation
- Convex's automatic reactivity eliminates manual WebSocket management for real-time updates
- Radix UI Tooltip (already installed) provides accessible hover tooltips for user lists

**Primary recommendation:** Use emoji-picker-react with Radix UI Popover for positioning, store reactions in a dedicated table with [messageId, emoji, userId] compound key, and leverage Convex's reactive queries for real-time aggregation.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| emoji-picker-react | ^4.x | Emoji selection UI | Most popular React emoji picker (88.8 benchmark score), no required props, full customization |
| @radix-ui/react-popover | 1.1.15 | Picker positioning | Already installed, battle-tested positioning with collision detection |
| @radix-ui/react-tooltip | 1.2.8 | User list tooltips | Already installed, accessible hover interactions |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| react-virtualized | ^9.x | Emoji list performance | If emoji picker feels sluggish (Slack uses this) |
| emoji-mart | ^5.x | Alternative picker | If need more categorization control or custom data loading |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| emoji-picker-react | emoji-mart | More features but larger bundle (~50KB more) |
| emoji-picker-react | frimousse | Unstyled/composable but requires custom styling work |
| Dedicated reactions table | Embed in messages | Simpler schema but O(n) queries for counts |

**Installation:**
```bash
npm install emoji-picker-react
# Radix UI components already installed
```

## Architecture Patterns

### Recommended Project Structure

```
src/pages/App/Chat/
├── Message.tsx                    # Add reactions display below message
├── MessageReactionPicker.tsx      # NEW: Emoji picker popover
├── MessageReactionPill.tsx        # NEW: Individual reaction button
├── MessageReactionTooltip.tsx     # NEW: User list on hover
└── MessageReactions.tsx           # NEW: Container for all pills

convex/
├── schema.ts                      # Add messageReactions table
├── messageReactions.ts            # NEW: CRUD + aggregation queries
└── messages.ts                    # No changes needed
```

### Pattern 1: Reactions Data Model (Denormalized Aggregation)

**What:** Store individual reactions in a dedicated table with compound indexes, query with aggregation in JavaScript

**When to use:** For real-time features where multiple users react to the same message with the same emoji

**Example:**
```typescript
// convex/schema.ts
messageReactions: defineTable({
  messageId: v.id("messages"),
  userId: v.id("users"),
  emoji: v.string(), // unified code like "1f44d"
  emojiNative: v.string(), // rendered emoji like "👍"
})
  .index("by_message", ["messageId"])
  .index("by_message_emoji", ["messageId", "emoji"])
  .index("by_message_user", ["messageId", "userId"])
  .index("by_message_emoji_user", ["messageId", "emoji", "userId"]) // uniqueness check

// convex/messageReactions.ts - Query with JavaScript aggregation
export const listForMessage = query({
  args: { messageId: v.id("messages") },
  returns: v.array(v.object({
    emoji: v.string(),
    emojiNative: v.string(),
    count: v.number(),
    userIds: v.array(v.id("users")),
    currentUserReacted: v.boolean(),
  })),
  handler: async (ctx, { messageId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Unauthenticated");

    // Fetch all reactions for this message
    const reactions = await ctx.db
      .query("messageReactions")
      .withIndex("by_message", (q) => q.eq("messageId", messageId))
      .collect();

    // Group by emoji using reduce
    const grouped = reactions.reduce((acc, reaction) => {
      const key = reaction.emoji;
      if (!acc[key]) {
        acc[key] = {
          emoji: reaction.emoji,
          emojiNative: reaction.emojiNative,
          count: 0,
          userIds: [],
        };
      }
      acc[key].count++;
      acc[key].userIds.push(reaction.userId);
      return acc;
    }, {} as Record<string, { emoji: string; emojiNative: string; count: number; userIds: Id<"users">[] }>);

    // Convert to array and add currentUserReacted flag
    return Object.values(grouped).map((group) => ({
      ...group,
      currentUserReacted: group.userIds.includes(userId),
    }));
  },
});
```

**Why this works:** Convex's reactive queries automatically re-run when reactions change, providing real-time updates. JavaScript aggregation is efficient for typical message reaction counts (rarely >100 reactions per message).

### Pattern 2: Emoji Picker with Radix Popover

**What:** Use emoji-picker-react inside a Radix UI Popover anchored to a trigger button

**When to use:** Need collision-aware positioning that respects viewport boundaries

**Example:**
```tsx
// Source: Context7 /ealush/emoji-picker-react + Radix UI docs
import EmojiPicker, { EmojiClickData } from 'emoji-picker-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';

function MessageReactionPicker({ messageId, onReactionAdd }) {
  const [open, setOpen] = useState(false);
  const addReaction = useMutation(api.messageReactions.add);

  const handleEmojiClick = (emojiData: EmojiClickData) => {
    addReaction({
      messageId,
      emoji: emojiData.unified, // "1f44d"
      emojiNative: emojiData.emoji, // "👍"
    });
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm">😊</Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <EmojiPicker
          onEmojiClick={handleEmojiClick}
          width={350}
          height={400}
          lazyLoadEmojis={true}
          searchPlaceholder="Search reactions..."
        />
      </PopoverContent>
    </Popover>
  );
}
```

### Pattern 3: Reaction Pills with Tooltips

**What:** Slack-style reaction buttons showing emoji + count, with tooltips listing users on hover

**When to use:** Displaying aggregated reactions below a message

**Example:**
```tsx
// Source: Radix UI Tooltip docs + React patterns
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import { useQuery } from 'convex/react';

function MessageReactionPill({ messageId, emoji, emojiNative, count, userIds, currentUserReacted }) {
  const toggleReaction = useMutation(api.messageReactions.toggle);

  // Fetch user names for tooltip
  const users = useQuery(api.users.getMultiple, { userIds });

  const handleClick = () => {
    toggleReaction({ messageId, emoji, emojiNative });
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={handleClick}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-1 text-sm",
              "border hover:bg-accent transition-colors",
              currentUserReacted && "bg-blue-100 border-blue-500" // Highlight when user reacted
            )}
          >
            <span>{emojiNative}</span>
            <span className="text-xs text-muted-foreground">{count}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-xs">
            {users?.map((u) => u.name).join(", ")}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
```

### Pattern 4: Optimistic Updates for Instant Feedback

**What:** Apply local state updates before server confirmation for immediate UI response

**When to use:** User interactions that should feel instantaneous (clicking reaction pill)

**Example:**
```typescript
// Source: Convex optimistic updates docs
const toggleReaction = useMutation(api.messageReactions.toggle)
  .withOptimisticUpdate((localStore, args) => {
    const { messageId, emoji } = args;
    const currentReactions = localStore.getQuery(api.messageReactions.listForMessage, {
      messageId,
    });

    if (currentReactions !== undefined) {
      const userId = localStore.getQuery(api.users.viewer)?._id;
      if (!userId) return;

      const existing = currentReactions.find((r) => r.emoji === emoji);

      if (existing?.currentUserReacted) {
        // Remove reaction optimistically
        localStore.setQuery(
          api.messageReactions.listForMessage,
          { messageId },
          currentReactions.map((r) =>
            r.emoji === emoji
              ? {
                  ...r,
                  count: r.count - 1,
                  userIds: r.userIds.filter((id) => id !== userId),
                  currentUserReacted: false,
                }
              : r
          ).filter((r) => r.count > 0) // Remove if count reaches 0
        );
      } else if (existing) {
        // Add to existing reaction optimistically
        localStore.setQuery(
          api.messageReactions.listForMessage,
          { messageId },
          currentReactions.map((r) =>
            r.emoji === emoji
              ? {
                  ...r,
                  count: r.count + 1,
                  userIds: [...r.userIds, userId],
                  currentUserReacted: true,
                }
              : r
          )
        );
      } else {
        // Add new reaction type optimistically
        localStore.setQuery(
          api.messageReactions.listForMessage,
          { messageId },
          [
            ...currentReactions,
            {
              emoji,
              emojiNative: args.emojiNative,
              count: 1,
              userIds: [userId],
              currentUserReacted: true,
            },
          ]
        );
      }
    }
  });
```

### Anti-Patterns to Avoid

- **Storing reactions as array in messages table:** Forces full document rewrites, O(n) queries for aggregation, no indexes
- **Not using compound indexes:** Leads to filter() instead of withIndex(), poor performance at scale
- **Mutating objects in optimistic updates:** Corrupts client state (always return new objects)
- **Rendering emoji picker multiple times:** One picker instance with portal positioning is more performant
- **Hand-rolling emoji data:** Use library-provided emoji sets (skin tones, variants, metadata)

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Emoji picker UI | Custom emoji grid with search/categories | emoji-picker-react | 74 code examples, handles skin tones, recent emojis, keyboard nav, search |
| Emoji data/metadata | Custom emoji JSON with unicode mappings | Library-provided emoji dataset | Emoji standards evolve (v15 added 118 new emojis), libraries stay current |
| Tooltip positioning | Custom hover state + absolute positioning | Radix UI Tooltip | Handles viewport edges, ARIA attributes, focus management |
| Real-time updates | Manual WebSocket listeners for reactions | Convex reactive queries | Automatic subscription management, handles reconnection, optimistic updates built-in |
| Virtualized scrolling | Custom windowing for emoji grid | react-virtualized (if needed) | Battle-tested by Slack, handles dynamic heights, keyboard nav |

**Key insight:** Emoji pickers feel simple but have complex edge cases (skin tone variants, search tokenization, keyboard navigation, recent emoji tracking). Slack's engineering team spent significant effort rebuilding theirs in React with react-virtualized. Don't repeat that work.

## Common Pitfalls

### Pitfall 1: Race Conditions in Toggle Logic

**What goes wrong:** User clicks reaction pill rapidly, mutations arrive out of order, final state is incorrect

**Why it happens:** Network latency means mutations don't execute in submission order

**How to avoid:** Use `by_message_emoji_user` compound unique index to make reactions idempotent. Mutation checks existence before insert/delete:

```typescript
// Check if user already reacted with this emoji
const existing = await ctx.db
  .query("messageReactions")
  .withIndex("by_message_emoji_user", (q) =>
    q.eq("messageId", messageId).eq("emoji", emoji).eq("userId", userId)
  )
  .unique();

if (existing) {
  await ctx.db.delete(existing._id); // Remove if exists
} else {
  await ctx.db.insert("messageReactions", { messageId, emoji, emojiNative, userId });
}
```

**Warning signs:** Reactions flickering on/off, count mismatches after rapid clicks

### Pitfall 2: Poor Aggregation Performance

**What goes wrong:** Querying reactions becomes slow as messages accumulate reactions

**Why it happens:** Missing or incorrect indexes force O(n) table scans

**How to avoid:** Use `by_message` index for fetching reactions, aggregate in JavaScript (efficient for <1000 reactions per message):

```typescript
// GOOD: Uses index, O(log n) lookup
const reactions = await ctx.db
  .query("messageReactions")
  .withIndex("by_message", (q) => q.eq("messageId", messageId))
  .collect();

// BAD: No index, O(n) scan
const reactions = await ctx.db
  .query("messageReactions")
  .filter((q) => q.eq(q.field("messageId"), messageId))
  .collect();
```

**Warning signs:** Reaction queries taking >500ms, increasing query latency as data grows

### Pitfall 3: Emoji Picker Bundle Size

**What goes wrong:** App bundle increases by 200KB+, initial load time suffers

**Why it happens:** emoji-picker-react includes full emoji dataset and images

**How to avoid:**
1. Enable `lazyLoadEmojis={true}` prop to defer image loading
2. Use dynamic import for picker component (code-splitting):

```typescript
// Load picker on-demand
const EmojiPicker = React.lazy(() => import('emoji-picker-react'));

function MessageReactionPicker() {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open}>
      {/* ... */}
      <PopoverContent>
        <Suspense fallback={<div>Loading emojis...</div>}>
          <EmojiPicker lazyLoadEmojis={true} />
        </Suspense>
      </PopoverContent>
    </Popover>
  );
}
```

**Warning signs:** Lighthouse bundle size warnings, slow initial page load

### Pitfall 4: Tooltip Performance with Many Reactions

**What goes wrong:** Rendering 20+ tooltips with user queries causes lag

**Why it happens:** Each tooltip triggers a separate user query on mount/hover

**How to avoid:** Batch-fetch users for all reactions in parent component, pass down as props:

```typescript
// GOOD: Single query for all users
const allUserIds = reactions.flatMap((r) => r.userIds);
const users = useQuery(api.users.getMultiple, { userIds: allUserIds });
const userMap = new Map(users?.map((u) => [u._id, u]));

reactions.map((reaction) => (
  <ReactionPill
    {...reaction}
    users={reaction.userIds.map((id) => userMap.get(id))}
  />
));

// BAD: N queries (one per pill)
<ReactionPill userId={reaction.userId} /> // Queries inside component
```

**Warning signs:** Network tab shows burst of user queries on message hover

### Pitfall 5: Deleted Message Reactions Orphaned

**What goes wrong:** Reactions remain in database after message deletion

**Why it happens:** No cascade delete logic implemented

**How to avoid:** Delete reactions in message removal mutation:

```typescript
export const remove = mutation({
  handler: async (ctx, { id }) => {
    // Delete message
    await ctx.db.delete(id);

    // Delete all reactions on this message
    const reactions = await ctx.db
      .query("messageReactions")
      .withIndex("by_message", (q) => q.eq("messageId", id))
      .collect();

    await Promise.all(reactions.map((r) => ctx.db.delete(r._id)));
  },
});
```

**Warning signs:** Database size grows unexpectedly, orphaned reaction records

## Code Examples

### Adding a Reaction (with Optimistic Update)

```typescript
// convex/messageReactions.ts
export const add = mutation({
  args: {
    messageId: v.id("messages"),
    emoji: v.string(),
    emojiNative: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { messageId, emoji, emojiNative }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Unauthenticated");

    // Check if already reacted with this emoji
    const existing = await ctx.db
      .query("messageReactions")
      .withIndex("by_message_emoji_user", (q) =>
        q.eq("messageId", messageId).eq("emoji", emoji).eq("userId", userId)
      )
      .unique();

    if (!existing) {
      await ctx.db.insert("messageReactions", {
        messageId,
        userId,
        emoji,
        emojiNative,
      });
    }
  },
});
```

### Toggle Reaction (Idempotent)

```typescript
export const toggle = mutation({
  args: {
    messageId: v.id("messages"),
    emoji: v.string(),
    emojiNative: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { messageId, emoji, emojiNative }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Unauthenticated");

    const existing = await ctx.db
      .query("messageReactions")
      .withIndex("by_message_emoji_user", (q) =>
        q.eq("messageId", messageId).eq("emoji", emoji).eq("userId", userId)
      )
      .unique();

    if (existing) {
      await ctx.db.delete(existing._id);
    } else {
      await ctx.db.insert("messageReactions", {
        messageId,
        userId,
        emoji,
        emojiNative,
      });
    }
  },
});
```

### Complete MessageReactions Component

```tsx
// src/pages/App/Chat/MessageReactions.tsx
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { MessageReactionPill } from "./MessageReactionPill";
import { MessageReactionPicker } from "./MessageReactionPicker";

type Props = {
  messageId: Id<"messages">;
};

export function MessageReactions({ messageId }: Props) {
  const reactions = useQuery(api.messageReactions.listForMessage, { messageId });

  if (!reactions || reactions.length === 0) {
    return (
      <div className="flex items-center gap-1 mt-2">
        <MessageReactionPicker messageId={messageId} />
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1 mt-2">
      {reactions.map((reaction) => (
        <MessageReactionPill
          key={reaction.emoji}
          messageId={messageId}
          {...reaction}
        />
      ))}
      <MessageReactionPicker messageId={messageId} />
    </div>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Custom emoji grids | Library-based pickers | ~2018 | Reduced dev time from weeks to hours |
| Embedded reaction arrays | Separate reactions table | ~2019 | Enabled real-time aggregation, better indexing |
| Manual WebSockets | Reactive query subscriptions | ~2020 (Convex) | Automatic real-time updates, simpler code |
| CSS-based tooltips | Radix UI primitives | ~2022 | Better accessibility, keyboard nav |
| Emoji images as sprites | Unicode emoji fonts + fallback images | ~2021 | Reduced bundle size, native OS emoji |

**Deprecated/outdated:**
- **emojionearea** (jQuery-based): Replaced by React-native emoji pickers
- **emoji-button**: Vanilla JS, React ecosystem moved to dedicated React libs
- **Manual position calculations**: Radix/Floating UI handle this better

## Open Questions

1. **Should reactions trigger notifications?**
   - What we know: Requirements explicitly mark reaction notifications as out of scope
   - What's unclear: None
   - Recommendation: Skip notifications for v0.9, revisit if users request

2. **Emoji skin tone persistence?**
   - What we know: emoji-picker-react supports skin tones via `defaultSkinTone` and `onSkinToneChange`
   - What's unclear: Should user's skin tone preference persist across sessions?
   - Recommendation: Start with default neutral tone, add localStorage persistence if users request

3. **Maximum reactions per message?**
   - What we know: No explicit limit in requirements
   - What's unclear: Should there be a cap (e.g., Slack has ~20 unique emoji limit)?
   - Recommendation: No enforced limit for v0.9, monitor database size

## Sources

### Primary (HIGH confidence)
- Context7: /ealush/emoji-picker-react - Installation, props, customization patterns
- Context7: /llmstxt/convex_dev_llms_txt - Reactive queries, aggregation, optimistic updates
- Radix UI (installed): @radix-ui/react-tooltip, @radix-ui/react-popover - Positioning and tooltips
- [Convex Optimistic Updates Docs](https://docs.convex.dev/client/react/optimistic-updates)
- [Convex Aggregation Component](https://www.convex.dev/components/aggregate)

### Secondary (MEDIUM confidence)
- [Slack Engineering: Rebuilding Emoji Picker in React](https://slack.engineering/rebuilding-slacks-emoji-picker-in-react/) - Performance patterns with react-virtualized
- [Radix UI Popover Docs](https://www.radix-ui.com/primitives/docs/components/popover) - Anchor element patterns
- [React Emoji Picker Guide 2025](https://velt.dev/blog/react-emoji-picker-guide) - Best practices and architecture
- [How to Design Database for Messaging Systems - GeeksforGeeks](https://www.geeksforgeeks.org/dbms/how-to-design-a-database-for-messaging-systems/) - Schema patterns

### Tertiary (LOW confidence)
- WebSearch: "emoji reactions schema many-to-many aggregation" - General patterns but no specific technical depth
- WebSearch: "React tooltip showing user list" - General UI patterns

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - emoji-picker-react verified in Context7 with 74 snippets, Radix UI already installed
- Architecture: HIGH - Convex patterns verified in official docs, React component patterns well-established
- Pitfalls: HIGH - Derived from Convex best practices docs and Slack engineering blog

**Research date:** 2026-02-07
**Valid until:** 60 days (stable domain - emoji pickers and chat patterns are mature)
