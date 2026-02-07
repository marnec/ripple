# Phase 09: @User Mentions in Chat - Research

**Researched:** 2026-02-07
**Domain:** @mention autocomplete in chat messages, push notifications for mentions
**Confidence:** HIGH

## Summary

Phase 09 adds @mention functionality to chat messages, enabling users to mention workspace members with autocomplete and receive notifications. The CRITICAL insight: Ripple already has MOST of the infrastructure needed.

**Existing infrastructure from prior phases:**
- Phase 06.1: `UserMention` inline content component (renders bold @Name)
- Phase 06.1: `extractMentionedUserIds()` utility (parses BlockNote JSON for mentions)
- Phase 07: `taskNotifications.ts` with `notifyUserMentions` action (sends push notifications)
- Current chat: MessageComposer ALREADY uses BlockNote with custom inline content (taskMention, projectReference)

**Key architectural insight:** Chat composer is NOT a plain textarea — it's ALREADY a BlockNote editor with a custom schema (taskMention, projectReference). This means adding @mentions is a SCHEMA EXTENSION, not a wholesale replacement like Phase 06.1 had to do for task comments.

**The implementation path:**
1. Add `userMention` to MessageComposer schema (alongside existing taskMention/projectReference)
2. Add `@` trigger to existing SuggestionMenuController (currently only has `#` for tasks/projects)
3. Update MessageRenderer to render userMention inline content (add case to switch statement)
4. Create chat-specific notification action (similar to taskNotifications, but for chat messages)
5. Wire messages.send and messages.update to extract mentions and schedule notifications

**Primary recommendation:** Extend the existing chat BlockNote schema and SuggestionMenuController pattern. Reuse UserMention component and notification infrastructure. Add new `chatNotifications.ts` action for chat-specific notifications ("Alice mentioned you in #general").

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @blocknote/core | 0.46.2 | Block editor engine | Already in use for chat, handles custom inline content |
| @blocknote/react | 0.46.2 | React components | Already in use, provides SuggestionMenuController |
| @blocknote/shadcn | 0.46.2 | Shadcn UI theme | Already in use, provides BlockNoteView |
| web-push | 3.6.7 | Push notification delivery | Already in use for notifications |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| convex/react | 1.31.7 | Real-time data sync | Already integrated, message updates sync automatically |
| lucide-react | 0.563.0 | Icons for autocomplete | User icon in @ autocomplete picker |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| BlockNote userMention | Plain regex parsing | BlockNote gives us proven patterns, consistent with task comments |
| Reuse UserMention component | Create new ChatMention component | UserMention already works, no need to duplicate |
| Chat-specific notifications | Reuse taskNotifications | Chat needs different notification text ("in #general" not "in task") |

**Installation:**
```bash
# All dependencies already installed
```

## Architecture Patterns

### Current Chat Message Structure
```
MessageComposer (BlockNote editor with custom schema):
- Custom schema: taskMention, projectReference inline content
- SuggestionMenuController with # trigger for tasks/projects
- JSON storage (body field) + plainText extraction

MessageRenderer (custom JSON parser):
- Renders BlockNote JSON without BlockNote editor
- Switch cases for taskMention, projectReference
- Lightweight, no editor overhead

Messages backend:
- messages.send mutation creates message, schedules pushNotifications
- messages.update mutation updates message (NO notifications currently)
```

### Pattern 1: Extending Existing Chat Schema
**What:** Add userMention to existing chat schema alongside taskMention/projectReference
**When to use:** When chat already uses BlockNote with custom inline content
**Example:**
```typescript
// Source: src/pages/App/Chat/MessageComposer.tsx (lines 40-47)
// BEFORE (current schema)
const schema = BlockNoteSchema.create({
  blockSpecs: { ...remainingBlockSpecs },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    taskMention: TaskMention,
    projectReference: ProjectReference,
  },
});

// AFTER (with userMention)
import { UserMention } from "../Project/CustomInlineContent/UserMention";

const schema = BlockNoteSchema.create({
  blockSpecs: { ...remainingBlockSpecs },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    taskMention: TaskMention,
    projectReference: ProjectReference,
    userMention: UserMention, // ADDED
  },
});
```

### Pattern 2: Multiple Triggers in SuggestionMenuController
**What:** Single SuggestionMenuController handling multiple trigger characters
**When to use:** When autocomplete needs different data sources per trigger
**Example:**
```typescript
// Source: Adapted from MessageComposer.tsx (lines 247-310)
// BEFORE: Only # trigger for tasks/projects
<SuggestionMenuController
  triggerCharacter={"#"}
  getItems={async (query) => { /* tasks and projects */ }}
/>

// AFTER: Add @ trigger for user mentions
// Note: BlockNote supports multiple SuggestionMenuController instances
<SuggestionMenuController
  triggerCharacter={"#"}
  getItems={async (query) => { /* tasks and projects */ }}
/>
<SuggestionMenuController
  triggerCharacter={"@"}
  getItems={async (query) => {
    if (!workspaceMembers) return [];
    return workspaceMembers
      .filter(m => m.name?.toLowerCase().includes(query.toLowerCase()))
      .filter(m => m._id !== currentUserId) // Don't suggest self
      .slice(0, 10)
      .map(m => ({
        title: m.name ?? "Unknown",
        onItemClick: () => {
          editor.insertInlineContent([
            { type: "userMention", props: { userId: m._id } },
            " ",
          ]);
        },
        icon: <Avatar {...} />,
        group: "Workspace members",
      }));
  }}
/>
```

### Pattern 3: Lightweight Message Renderer (No BlockNote)
**What:** Parse BlockNote JSON manually without loading BlockNote editor
**When to use:** When displaying many messages (list view), editor overhead too expensive
**Example:**
```typescript
// Source: src/pages/App/Chat/MessageRenderer.tsx (lines 212-239)
// Current pattern - extend with userMention case
function InlineRenderer({ content }: { content: InlineContent }) {
  switch (content.type) {
    case "text":
      return <StyledText text={content.text} styles={content.styles} />;
    case "link":
      return <a href={content.href}>...</a>;
    case "taskMention":
      return <TaskMentionChip taskId={content.props.taskId} />;
    case "projectReference":
      return <ProjectReferenceChip projectId={content.props.projectId} />;
    case "userMention": // ADDED
      return <UserMentionRenderer userId={content.props.userId} />;
    default:
      return null;
  }
}
```

### Pattern 4: Chat-Specific Notification Actions
**What:** Separate notification action for chat mentions vs task mentions
**When to use:** When notification content differs by context (chat vs tasks)
**Example:**
```typescript
// Source: Adapted from convex/taskNotifications.ts
// NEW FILE: convex/chatNotifications.ts
export const notifyMessageMentions = internalAction({
  args: {
    messageId: v.id("messages"),
    mentionedUserIds: v.array(v.string()),
    channelId: v.id("channels"),
    mentionedBy: v.object({
      name: v.string(),
      id: v.id("users"),
    }),
  },
  handler: async (ctx, { messageId, mentionedUserIds, channelId, mentionedBy }) => {
    const channel = await ctx.runQuery(api.channels.get, { id: channelId });

    const notification = JSON.stringify({
      title: `${mentionedBy.name} mentioned you in #${channel.name}`,
      body: "[message preview]",
      data: {
        url: `/workspaces/${channel.workspaceId}/channels/${channelId}`,
      },
    });

    // Send to mentioned users (filter out author already done in mutation)
    // ... webpush logic ...
  },
});
```

### Pattern 5: Mention Extraction in Mutations
**What:** Extract mentions from BlockNote JSON, schedule notifications
**When to use:** When creating or updating content with @mentions
**Example:**
```typescript
// Source: Adapted from convex/tasks.ts (Phase 07.2 pattern)
// In messages.send mutation (after ctx.db.insert)
import { extractMentionedUserIds } from "./utils/blocknote";
import { internal } from "./_generated/api";

// Extract mentions from body
const mentionedUserIds = extractMentionedUserIds(body);
const filteredMentions = mentionedUserIds.filter(id => id !== userId); // Exclude self

if (filteredMentions.length > 0) {
  await ctx.scheduler.runAfter(0, internal.chatNotifications.notifyMessageMentions, {
    messageId: messageId,
    mentionedUserIds: filteredMentions,
    channelId: channelId,
    mentionedBy: { name: user.name ?? user.email ?? "Someone", id: userId },
  });
}
```

### Anti-Patterns to Avoid
- **Rewriting MessageComposer from scratch:** Chat ALREADY uses BlockNote, just extend schema
- **Loading BlockNote editor for each message:** MessageRenderer manually parses JSON for performance
- **Single notification for all events:** Chat mentions need different notification text than task mentions
- **Not filtering self-mentions:** Mentioning yourself should NOT notify you

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| @mention rendering | Custom @Name span | UserMention component from Phase 06.1 | Already handles loading, missing users, styling |
| Mention extraction | Regex parsing BlockNote JSON | extractMentionedUserIds from utils/blocknote | Handles nested content, links, edge cases |
| Push notifications | Custom web push logic | Existing notification actions pattern | VAPID setup, error handling, batching already solved |
| User autocomplete dropdown | Custom dropdown | SuggestionMenuController | Keyboard nav, positioning, filtering built-in |
| Message parsing | BlockNote editor in each message | Custom MessageRenderer | Performance - parsing JSON is 100x faster than editor instances |

**Key insight:** Phase 06.1 and Phase 07 already solved @mentions for task comments. Chat implementation is 80% code reuse.

## Common Pitfalls

### Pitfall 1: Schema Mismatch Between Composer and Renderer
**What goes wrong:** MessageComposer uses updated schema with userMention, but MessageRenderer doesn't handle it
**Why it happens:** Renderer is SEPARATE code (manual JSON parsing), not auto-synced with schema
**How to avoid:** After adding userMention to schema, ALSO add case to MessageRenderer switch statement
**Warning signs:** Messages with @mentions render as blank inline content, no errors in console

### Pitfall 2: Notifying ALL Mentions on Edit
**What goes wrong:** User edits message, all previously mentioned users get notified again
**Why it happens:** messages.update doesn't track which mentions are NEW vs existing
**How to avoid:** Phase 07.2 solves this for tasks by comparing old vs new mentions. For v1 chat, simpler approach: DON'T notify on edit (only on create)
**Warning signs:** Spam notifications when messages are edited

### Pitfall 3: Self-Mention Notifications
**What goes wrong:** User types @myself, receives notification from themselves
**Why it happens:** Forgetting to filter current user from mentionedUserIds
**How to avoid:** Always filter: `mentionedUserIds.filter(id => id !== userId)` before scheduling notifications
**Warning signs:** Notifications appear when you mention yourself

### Pitfall 4: Missing Workspace Members Query
**What goes wrong:** @ autocomplete shows empty list
**Why it happens:** MessageComposer doesn't query workspace members for autocomplete
**How to avoid:** Add `useQuery(api.workspaceMembers.membersByWorkspace, { workspaceId })` to MessageComposer
**Warning signs:** @ trigger shows empty dropdown

### Pitfall 5: Wrong Notification Context
**What goes wrong:** Chat mention notification says "in task" instead of "in #channel"
**Why it happens:** Reusing taskNotifications.notifyUserMentions instead of chat-specific action
**How to avoid:** Create separate chatNotifications.notifyMessageMentions action with channel context
**Warning signs:** Notification text references tasks, not channels

### Pitfall 6: MessageRenderer Performance Regression
**What goes wrong:** Message list becomes slow after adding userMention
**Why it happens:** Rendering UserMention component (with useQuery hook) for EVERY mention in EVERY message
**How to avoid:** Create lightweight UserMentionRenderer that batches user queries or uses cached data
**Warning signs:** Chat scrolling becomes laggy with many messages containing @mentions

### Pitfall 7: Autocomplete Suggests Channel Members, Not Workspace Members
**What goes wrong:** @ autocomplete only shows channel members, not all workspace members
**Why it happens:** Confusing workspace vs channel membership (channels are within workspaces)
**How to avoid:** Query workspace members, not channel members. Workspace-level scope matches requirement MENT-01
**Warning signs:** Private channel users can't @mention workspace members outside channel

## Code Examples

Verified patterns from official sources and existing codebase:

### Extend MessageComposer Schema
```typescript
// Source: src/pages/App/Chat/MessageComposer.tsx + Phase 06.1 pattern
import { UserMention } from "../Project/CustomInlineContent/UserMention";

const schema = BlockNoteSchema.create({
  blockSpecs: { ...remainingBlockSpecs },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    taskMention: TaskMention,
    projectReference: ProjectReference,
    userMention: UserMention, // Reuse from task comments
  },
});
```

### Add @ Autocomplete to MessageComposer
```typescript
// Source: Adapted from MessageComposer existing # autocomplete
// Query workspace members (add to MessageComposer component)
const workspaceMembers = useQuery(api.workspaceMembers.membersByWorkspace, {
  workspaceId
});
const currentUser = useQuery(api.users.viewer);

// Add second SuggestionMenuController (inside BlockNoteView, after existing # one)
<SuggestionMenuController
  triggerCharacter={"@"}
  getItems={async (query) => {
    if (!workspaceMembers || !currentUser) return [];

    return workspaceMembers
      .filter(m => m.name?.toLowerCase().includes(query.toLowerCase()))
      .filter(m => m._id !== currentUser._id) // Don't suggest self
      .slice(0, 10)
      .map(m => ({
        title: m.name ?? m.email ?? "Unknown",
        onItemClick: () => {
          editor.insertInlineContent([
            { type: "userMention", props: { userId: m._id } },
            " ",
          ]);
        },
        icon: <Avatar><AvatarFallback>{m.name?.[0] ?? "U"}</AvatarFallback></Avatar>,
        group: "Workspace members",
      }));
  }}
/>
```

### Extend MessageRenderer for UserMention
```typescript
// Source: src/pages/App/Chat/MessageRenderer.tsx
// Add to InlineRenderer switch statement (after projectReference case)

// At top of file, import
import { UserMentionRenderer } from "./UserMentionRenderer";

// In switch statement
case "userMention":
  return <UserMentionRenderer userId={content.props.userId} />;
```

### Create Lightweight UserMentionRenderer
```typescript
// Source: New component, inspired by UserMention but optimized for message lists
// NEW FILE: src/pages/App/Chat/UserMentionRenderer.tsx
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { Skeleton } from "@/components/ui/skeleton";

export const UserMentionRenderer = ({ userId }: { userId: string }) => {
  const user = useQuery(api.users.get, { id: userId as Id<"users"> });

  if (user === undefined) {
    return <Skeleton className="h-5 w-16 rounded inline-block align-middle" />;
  }

  if (user === null) {
    return (
      <span className="text-muted-foreground align-middle">@unknown-user</span>
    );
  }

  return (
    <span className="font-bold text-foreground align-middle" contentEditable={false}>
      @{user.name || "Unknown"}
    </span>
  );
};
```

### Create Chat Notifications Action
```typescript
// Source: Adapted from convex/taskNotifications.ts
// NEW FILE: convex/chatNotifications.ts
"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { api } from "./_generated/api";
import * as webpush from "web-push";

export const notifyMessageMentions = internalAction({
  args: {
    messageId: v.id("messages"),
    mentionedUserIds: v.array(v.string()),
    channelId: v.id("channels"),
    mentionedBy: v.object({
      name: v.string(),
      id: v.id("users"),
    }),
  },
  returns: v.null(),
  handler: async (ctx, { messageId, mentionedUserIds, channelId, mentionedBy }) => {
    // Get channel to build notification
    const channel = await ctx.runQuery(api.channels.get, { id: channelId });
    if (!channel) {
      console.error(`Channel ${channelId} not found for mention notification`);
      return null;
    }

    // Build notification payload
    const notification = JSON.stringify({
      title: `${mentionedBy.name} mentioned you in #${channel.name}`,
      body: "New mention in chat",
      data: {
        url: `/workspaces/${channel.workspaceId}/channels/${channelId}`,
      },
    });

    // Get mentioned users' push subscriptions
    const subscriptions = await ctx.runQuery(api.pushSubscription.usersSubscriptions, {
      usersIds: mentionedUserIds as any,
    });

    // Setup VAPID credentials
    const subject = process.env.VAPID_SUBJECT;
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;

    if (!subject || !publicKey || !privateKey) {
      console.error("Missing VAPID environment variables");
      return null;
    }

    webpush.setVapidDetails(subject, publicKey, privateKey);

    const notificationOptions = {
      TTL: 10000,
      vapidDetails: { subject, publicKey, privateKey },
    };

    // Send to all mentioned users' subscriptions
    await Promise.allSettled(
      subscriptions.map(async (subscription) => {
        const { endpoint, expirationTime, keys } = subscription;
        const id = endpoint.split("/").at(-1);

        return webpush
          .sendNotification({ endpoint, expirationTime, keys }, notification, notificationOptions)
          .then(() => {
            console.info(`Successfully sent chat mention notification to endpoint ID=${id}`);
          })
          .catch((error: { message: string }) => {
            console.error(`Failed to send chat mention notification to endpoint=${id}, err=${error.message}`);
          });
      }),
    );

    return null;
  },
});
```

### Wire messages.send for Mention Notifications
```typescript
// Source: convex/messages.ts, adapted from tasks.ts Phase 07.2 pattern
// In messages.send mutation, after ctx.db.insert and before existing pushNotifications call

import { internal } from "./_generated/api";
import { extractMentionedUserIds } from "./utils/blocknote";

// Extract mentions from body
const mentionedUserIds = extractMentionedUserIds(body);
const filteredMentions = mentionedUserIds.filter(id => id !== userId);

if (filteredMentions.length > 0) {
  await ctx.scheduler.runAfter(0, internal.chatNotifications.notifyMessageMentions, {
    messageId: messageId, // Note: need to capture messageId from insert
    mentionedUserIds: filteredMentions,
    channelId,
    mentionedBy: {
      name: user.name ?? user.email ?? "Someone",
      id: userId,
    },
  });
}

// Existing pushNotifications call remains (for channel-level notifications)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Plain textarea for chat | BlockNote editor | Earlier phases | Already supports custom inline content |
| Regex @username parsing | BlockNote inline content | Phase 06.1 (task comments) | Type-safe, editor-integrated |
| Manual notification sending | Scheduled actions | Phase 07 | Reliable, decoupled from mutations |
| Single mention format | Multiple inline types | Current chat | Already has #tasks, #projects - adding @users is consistent |

**Deprecated/outdated:**
- Plain text @username mentions: Breaks on username changes, no linking
- Single trigger character: Modern editors support multiple (# for entities, @ for people)

## Open Questions

### Question 1: Edit Notifications
**What we know:** Phase 07.2 implemented "only notify NEW mentions on edit" for tasks
**What's unclear:** Should chat messages support edit notifications, or only create?
**Recommendation:** For v1, only notify on create (simpler, matches Slack behavior). Edit notifications add complexity (need old mention tracking) with questionable value for fast-paced chat.

### Question 2: Mention Preview in Notification
**What we know:** Current channel notifications use plainText for preview
**What's unclear:** Should @mention notifications show message preview or just "mentioned you"?
**Recommendation:** Use plainText for preview (same as channel notifications). Gives context about WHY you were mentioned.

### Question 3: MessageRenderer Performance
**What we know:** UserMention component uses useQuery per mention
**What's unclear:** Will this cause performance issues in message lists with many mentions?
**Recommendation:** Create lightweight UserMentionRenderer (separate from UserMention) that still uses useQuery but is optimized. Convex query deduplication should handle multiple mentions of same user efficiently.

## Sources

### Primary (HIGH confidence)
- Existing codebase: `src/pages/App/Chat/MessageComposer.tsx` - BlockNote chat editor with custom inline content
- Existing codebase: `src/pages/App/Chat/MessageRenderer.tsx` - Custom JSON parser for messages
- Existing codebase: `src/pages/App/Project/CustomInlineContent/UserMention.tsx` - UserMention component
- Existing codebase: `convex/utils/blocknote.ts` - extractMentionedUserIds utility
- Existing codebase: `convex/taskNotifications.ts` - Notification action pattern
- Existing codebase: `convex/messages.ts` - Message mutations
- Existing codebase: `convex/workspaceMembers.ts` - membersByWorkspace query

### Secondary (MEDIUM confidence)
- [BlockNote - Suggestion Menus](https://www.blocknotejs.org/docs/react/components/suggestion-menus) - SuggestionMenuController docs
- [BlockNote - Mentions Menu Example](https://www.blocknotejs.org/examples/custom-schema/suggestion-menus-mentions) - @mention autocomplete demo
- [CSS-Tricks - @mention Autocomplete Best Practices](https://css-tricks.com/so-you-want-to-build-an-mention-autocomplete-feature/) - UX patterns
- [GitHub Blog - @mention Autocompletion](https://github.blog/news-insights/mention-autocompletion/) - Industry patterns

### Tertiary (LOW confidence)
None - all patterns verified in existing codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already in use
- Architecture: HIGH - Exact patterns exist in codebase (Phase 06.1 for @mentions, current chat for BlockNote)
- Pitfalls: HIGH - Based on existing implementation experience from Phase 06.1 and Phase 07
- Notification pattern: HIGH - taskNotifications.ts provides exact template

**Research date:** 2026-02-07
**Valid until:** 30 days (stable libraries, proven patterns in codebase)
