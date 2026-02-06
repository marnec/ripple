# Phase 7: Notifications & Polish - Research

**Researched:** 2026-02-06
**Domain:** Web Push Notifications, Convex scheduled actions, BlockNote content parsing
**Confidence:** HIGH

## Summary

Phase 7 adds push notifications for task assignments and @mentions. The excellent news: Ripple already has a complete push notification infrastructure with web-push library, VAPID configuration, service worker, and subscription management. The current system sends notifications for chat messages. The implementation path is straightforward: trigger notifications from task and comment mutations using the existing pattern.

The core architecture already exists:
- **Backend**: `web-push` (3.6.7) library with VAPID authentication, `pushNotifications.ts` action, `pushSubscription.ts` mutations/queries
- **Frontend**: `use-push-notifications.tsx` hook, service worker with notification click handling
- **Schema**: `pushSubscriptions` table with user-device subscriptions indexed by user and endpoint

Key implementation strategy: Use Convex `ctx.scheduler.runAfter(0, ...)` pattern to trigger notification actions from mutations. When a task is assigned or a user is mentioned, the mutation schedules a notification action that extracts mentioned user IDs from BlockNote JSON, queries subscriptions, and sends push notifications via web-push library.

BlockNote content parsing is the new challenge: Task descriptions and comments store BlockNote JSON documents containing custom inline content types (`userMention`). We need to recursively traverse the block tree to extract all `userId` values from inline content where `type === "userMention"`.

**Primary recommendation:** Reuse the existing `sendPushNotification` action pattern from messages. Create new internal actions `notifyTaskAssignment` and `notifyUserMention`. Schedule these from task mutations (`create`, `update`) and comment mutations (`create`, `update`) using `ctx.scheduler.runAfter(0, ...)`. Parse BlockNote JSON to extract mentioned user IDs. Filter out the action author from notification recipients.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| web-push | 3.6.7 | Send web push notifications | Industry standard Node.js library, already integrated |
| Convex scheduler | Built-in | Trigger actions from mutations | Recommended pattern for side effects after database writes |
| @blocknote/core | 0.46.2 | BlockNote document structure | Already in use for task descriptions and comments |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Push API (browser) | Native | Subscription management, permission requests | Frontend subscription handling |
| Service Worker API | Native | Background notification delivery | Required for push notifications |
| VAPID protocol | RFC 8292 | Application server authentication | Required by web-push spec |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| web-push | Firebase Cloud Messaging (FCM) | FCM adds Google dependency, web-push is standard-based |
| Scheduler pattern | Direct action calls | Actions can't access db directly, mutations ensure consistency |
| Parse BlockNote JSON | Store plain text mentions separately | Denormalization increases complexity, JSON is source of truth |

**Installation:**
```bash
# All dependencies already installed
# web-push: 3.6.7 (in package.json)
# @blocknote/core: 0.46.2 (in package.json)
```

## Architecture Patterns

### Current Push Notification Flow (Messages)
```
1. User sends message → messages.send mutation
2. Mutation inserts message to database
3. Mutation schedules pushNotifications.sendPushNotification action
4. Action queries channel members (workspace members currently)
5. Action queries pushSubscriptions for each member
6. Action sends web-push notification to each subscription
7. Service worker displays notification
8. User clicks notification → navigate to channel
```

### Pattern 1: Schedule Notification from Mutation
**What:** Use `ctx.scheduler.runAfter(0, ...)` to trigger notification action after successful mutation
**When to use:** When database write must succeed before notification is sent
**Example:**
```typescript
// Source: convex/messages.ts (existing pattern)
export const send = mutation({
  args: { channelId: v.id("channels"), body: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    // ... validation ...

    await ctx.db.insert("messages", { ...args, userId });

    // Schedule notification action
    await ctx.scheduler.runAfter(0, api.pushNotifications.sendPushNotification, {
      channelId: args.channelId,
      body: args.body,
      author: { name: user.name, id: userId },
    });
  },
});
```

### Pattern 2: Internal Action for Notifications
**What:** Create internal actions that query subscriptions and send notifications
**When to use:** For all notification sending (keeps logic separate from mutations)
**Example:**
```typescript
// Source: convex/pushNotifications.ts (existing pattern, adapted for tasks)
export const notifyTaskAssignment = action({
  args: {
    taskId: v.id("tasks"),
    assigneeId: v.id("users"),
    taskTitle: v.string(),
    assignedBy: v.object({ name: v.string(), id: v.id("users") }),
  },
  returns: v.null(),
  handler: async (ctx, { taskId, assigneeId, taskTitle, assignedBy }) => {
    // Get task to build notification URL
    const task = await ctx.runQuery(api.tasks.get, { id: taskId });

    const notification = JSON.stringify({
      title: `${assignedBy.name} assigned you a task`,
      body: taskTitle,
      data: {
        url: `/workspaces/${task.workspaceId}/projects/${task.projectId}/tasks/${taskId}`,
      },
    });

    // Query assignee's subscriptions
    const subscriptions = await ctx.runQuery(api.pushSubscription.usersSubscriptions, {
      usersIds: [assigneeId],
    });

    // Send via web-push (existing pattern)
    // ... webpush.sendNotification calls ...
  },
});
```

### Pattern 3: Parse BlockNote JSON for Mentions
**What:** Recursively traverse BlockNote document to extract userMention inline content
**When to use:** When detecting @mentions in task descriptions or comments
**Example:**
```typescript
// Source: New pattern based on BlockNote document structure
type BlockNoteDocument = Array<{
  type: string;
  content?: Array<InlineContent>;
  children?: BlockNoteDocument;
}>;

type InlineContent =
  | { type: "text"; text: string; styles: object }
  | { type: "link"; content: InlineContent[]; href: string }
  | { type: "userMention"; props: { userId: string } }; // Custom inline content

function extractMentionedUserIds(document: BlockNoteDocument): string[] {
  const userIds = new Set<string>();

  function traverseBlocks(blocks: BlockNoteDocument) {
    for (const block of blocks) {
      // Check inline content
      if (block.content) {
        for (const inline of block.content) {
          if (inline.type === "userMention") {
            userIds.add(inline.props.userId);
          }
          // Links can contain nested inline content
          if (inline.type === "link" && inline.content) {
            // Recursively check link content (though mentions in links unlikely)
          }
        }
      }
      // Recursively check children blocks
      if (block.children) {
        traverseBlocks(block.children);
      }
    }
  }

  traverseBlocks(document);
  return Array.from(userIds);
}

// Usage in mutation:
const description = JSON.parse(args.description);
const mentionedUserIds = extractMentionedUserIds(description);
```

### Pattern 4: Detect Changes in Assignee Field
**What:** Compare old and new assignee values to trigger assignment notifications
**When to use:** In task update mutations, only notify when assignee actually changes
**Example:**
```typescript
// Source: New pattern for task updates
export const update = mutation({
  args: {
    id: v.id("tasks"),
    assigneeId: v.optional(v.id("users")),
    // ... other fields ...
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    const task = await ctx.db.get(args.id);

    // Detect assignee change
    const assigneeChanged = args.assigneeId !== undefined &&
                           args.assigneeId !== task.assigneeId;

    await ctx.db.patch(args.id, { assigneeId: args.assigneeId });

    // Only notify if assignee changed and is not self-assignment
    if (assigneeChanged && args.assigneeId !== userId) {
      await ctx.scheduler.runAfter(0, internal.notifications.notifyTaskAssignment, {
        taskId: args.id,
        assigneeId: args.assigneeId,
        taskTitle: task.title,
        assignedBy: { name: user.name, id: userId },
      });
    }
  },
});
```

### Pattern 5: Detect New Mentions vs Existing
**What:** Compare old and new BlockNote content to find newly added mentions
**When to use:** In update mutations, only notify users who are newly mentioned
**Example:**
```typescript
// Source: New pattern for efficient mention detection
export const updateTaskDescription = mutation({
  args: {
    id: v.id("tasks"),
    description: v.string(), // BlockNote JSON
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.id);

    // Extract mentions from old and new content
    const oldMentions = task.description
      ? new Set(extractMentionedUserIds(JSON.parse(task.description)))
      : new Set();
    const newMentions = new Set(extractMentionedUserIds(JSON.parse(args.description)));

    // Find newly added mentions
    const addedMentions = Array.from(newMentions).filter(id => !oldMentions.has(id));

    await ctx.db.patch(args.id, { description: args.description });

    // Notify only newly mentioned users
    if (addedMentions.length > 0) {
      await ctx.scheduler.runAfter(0, internal.notifications.notifyUserMentions, {
        taskId: args.id,
        mentionedUserIds: addedMentions,
        // ... context ...
      });
    }
  },
});
```

### Anti-Patterns to Avoid
- **Sending notifications from actions directly:** Actions can't ensure mutations succeeded
- **Not filtering out the author:** Don't notify users about their own actions
- **Parsing BlockNote on every render:** Parse once in mutation, store extracted IDs if needed
- **Notification spam:** Always check if the change is meaningful (assignee changed, new mentions only)

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Push notification delivery | Custom WebSocket server | Web Push API + web-push library | Browser-native, works offline, handles retries |
| VAPID key management | Manual JWT signing | web-push.setVapidDetails() | Library handles all RFC 8292 complexity |
| Service worker lifecycle | Custom background scripts | Browser Service Worker API | Proper lifecycle, update handling, persistence |
| Subscription management | Store endpoint strings | Full PushSubscription object | Includes keys, expiration, all required fields |
| BlockNote traversal | String regex for @mentions | Recursive block/inline traversal | JSON structure preserves user IDs, handles edits |
| Notification deduplication | Manual tracking | Convex transaction + scheduler | Scheduler ensures notification only sent if mutation succeeds |

**Key insight:** Web Push is a standard protocol with complex authentication and encryption requirements. The web-push library abstracts all of this. Never try to implement VAPID or push message encryption manually.

## Common Pitfalls

### Pitfall 1: Notifying Author of Their Own Actions
**What goes wrong:** User assigns themselves to a task and receives a notification
**Why it happens:** Notification logic doesn't filter out the action author
**How to avoid:** Always exclude `author.id` from notification recipient list
**Warning signs:** Self-notifications appearing in tests, users reporting spam

### Pitfall 2: Parsing BlockNote String as Plain Text
**What goes wrong:** Trying to use regex to find @username in BlockNote JSON fails
**Why it happens:** BlockNote stores structured JSON, not plain text with @ symbols
**How to avoid:** Parse JSON, traverse blocks array, check inline content `type === "userMention"`
**Warning signs:** Mentions not triggering notifications, regex failing on valid mentions

### Pitfall 3: Missing VAPID Environment Variables
**What goes wrong:** Action throws "Missing required VAPID variables" error
**Why it happens:** VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY not set in Convex env
**How to avoid:** Verify all three VAPID env vars exist before deployment, use same keys as frontend
**Warning signs:** Push notifications work in dev but fail in production

### Pitfall 4: Notification Spam on Every Edit
**What goes wrong:** User edits task description, all mentioned users get notified again
**Why it happens:** Not comparing old vs new mentions, notifying on every update
**How to avoid:** Extract mentions from both old and new content, only notify newly added mentions
**Warning signs:** Users reporting multiple notifications for same task

### Pitfall 5: Action Timing Issues
**What goes wrong:** Notification action queries task before mutation commits
**Why it happens:** Using `runAction` instead of scheduler, or scheduling before db write
**How to avoid:** Always call `ctx.db.insert/patch` BEFORE `ctx.scheduler.runAfter`
**Warning signs:** Notifications reference old data, "task not found" errors in actions

### Pitfall 6: Expired or Invalid Subscriptions
**What goes wrong:** web-push fails with 410 Gone or 404 Not Found errors
**Why it happens:** Browser revoked subscription, but database still has old endpoint
**How to avoid:** Handle web-push errors, delete invalid subscriptions from database
**Warning signs:** Push errors in logs, some users never receive notifications

### Pitfall 7: Service Worker Not Registered
**What goes wrong:** Push subscription fails with "No service worker registration found"
**Why it happens:** Service worker not registered before requesting push permission
**How to avoid:** Ensure `navigator.serviceWorker.register()` completes before push setup
**Warning signs:** Push notifications fail in production but work in dev

### Pitfall 8: Incomplete Notification Payload
**What goes wrong:** Notification appears blank or with default text
**Why it happens:** Missing title/body in notification JSON, or data.url not set
**How to avoid:** Always include title, body, and data.url in notification payload
**Warning signs:** Generic notifications, click doesn't navigate anywhere

## Code Examples

Verified patterns from official sources and existing codebase:

### Notify on Task Assignment
```typescript
// Source: New pattern, adapted from convex/messages.ts scheduler pattern
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation } from "./_generated/server";

export const update = mutation({
  args: {
    id: v.id("tasks"),
    assigneeId: v.optional(v.id("users")),
    title: v.optional(v.string()),
    // ... other fields
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const task = await ctx.db.get(args.id);
    if (!task) throw new ConvexError("Task not found");

    // Check if assignee changed
    const assigneeChanged = args.assigneeId !== undefined &&
                           args.assigneeId !== task.assigneeId;

    // Update task
    await ctx.db.patch(args.id, {
      ...(args.assigneeId !== undefined && { assigneeId: args.assigneeId }),
      ...(args.title !== undefined && { title: args.title }),
    });

    // Notify assignee (if changed and not self-assignment)
    if (assigneeChanged && args.assigneeId && args.assigneeId !== userId) {
      const user = await ctx.db.get(userId);
      await ctx.scheduler.runAfter(0, internal.taskNotifications.notifyTaskAssignment, {
        taskId: args.id,
        assigneeId: args.assigneeId,
        taskTitle: args.title ?? task.title,
        assignedBy: { name: user?.name ?? "Someone", id: userId },
      });
    }

    return null;
  },
});
```

### Internal Action: Send Task Assignment Notification
```typescript
// Source: Adapted from convex/pushNotifications.ts pattern
import { v } from "convex/values";
import { internal, api } from "./_generated/api";
import { internalAction } from "./_generated/server";
import * as webpush from "web-push";

export const notifyTaskAssignment = internalAction({
  args: {
    taskId: v.id("tasks"),
    assigneeId: v.id("users"),
    taskTitle: v.string(),
    assignedBy: v.object({
      name: v.string(),
      id: v.id("users"),
    }),
  },
  returns: v.null(),
  handler: async (ctx, { taskId, assigneeId, taskTitle, assignedBy }) => {
    // Get task details for URL
    const task = await ctx.runQuery(api.tasks.get, { id: taskId });
    if (!task) return null;

    const notification = JSON.stringify({
      title: `${assignedBy.name} assigned you a task`,
      body: taskTitle,
      data: {
        url: `/workspaces/${task.workspaceId}/projects/${task.projectId}?task=${taskId}`,
      },
    });

    // Setup VAPID
    const subject = process.env.VAPID_SUBJECT;
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;

    if (!subject || !publicKey || !privateKey) {
      console.error("Missing VAPID environment variables");
      return null;
    }

    webpush.setVapidDetails(subject, publicKey, privateKey);

    // Get assignee subscriptions
    const subscriptions = await ctx.runQuery(api.pushSubscription.usersSubscriptions, {
      usersIds: [assigneeId],
    });

    // Send to all user's devices
    await Promise.allSettled(
      subscriptions.map(async (subscription) => {
        const { endpoint, expirationTime, keys } = subscription;
        return webpush
          .sendNotification(
            { endpoint, expirationTime, keys },
            notification,
            { TTL: 10000, vapidDetails: { subject, publicKey, privateKey } }
          )
          .catch((error) => {
            console.error(`Push notification failed: ${error.message}`);
            // TODO: Delete invalid subscriptions
          });
      })
    );

    return null;
  },
});
```

### Extract Mentioned Users from BlockNote JSON
```typescript
// Source: New utility based on BlockNote document structure
type BlockNoteBlock = {
  type: string;
  content?: InlineContent[];
  children?: BlockNoteBlock[];
  [key: string]: unknown;
};

type InlineContent =
  | { type: "text"; text: string; styles: Record<string, unknown> }
  | { type: "link"; content: InlineContent[]; href: string }
  | { type: "userMention"; props: { userId: string } }
  | { type: string; [key: string]: unknown };

export function extractMentionedUserIds(documentJson: string): string[] {
  try {
    const document: BlockNoteBlock[] = JSON.parse(documentJson);
    const userIds = new Set<string>();

    function traverseBlocks(blocks: BlockNoteBlock[]) {
      for (const block of blocks) {
        // Check inline content array
        if (Array.isArray(block.content)) {
          for (const inline of block.content) {
            if (inline.type === "userMention" &&
                typeof inline.props?.userId === "string") {
              userIds.add(inline.props.userId);
            }
            // Handle nested content in links
            if (inline.type === "link" && Array.isArray(inline.content)) {
              for (const nested of inline.content) {
                if (nested.type === "userMention" &&
                    typeof nested.props?.userId === "string") {
                  userIds.add(nested.props.userId);
                }
              }
            }
          }
        }
        // Recursively process child blocks
        if (Array.isArray(block.children)) {
          traverseBlocks(block.children);
        }
      }
    }

    traverseBlocks(document);
    return Array.from(userIds);
  } catch (error) {
    console.error("Failed to parse BlockNote document:", error);
    return [];
  }
}
```

### Notify on New Mentions in Task Description
```typescript
// Source: New pattern for mention detection
import { internal } from "./_generated/api";
import { mutation } from "./_generated/server";
import { extractMentionedUserIds } from "./utils/blocknote";

export const updateDescription = mutation({
  args: {
    id: v.id("tasks"),
    description: v.string(), // BlockNote JSON
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const task = await ctx.db.get(args.id);
    if (!task) throw new ConvexError("Task not found");

    // Extract old and new mentions
    const oldMentions = task.description
      ? new Set(extractMentionedUserIds(task.description))
      : new Set<string>();
    const newMentions = new Set(extractMentionedUserIds(args.description));

    // Find newly added mentions (exclude author)
    const addedMentions = Array.from(newMentions)
      .filter(id => !oldMentions.has(id) && id !== userId);

    // Update description
    await ctx.db.patch(args.id, { description: args.description });

    // Notify newly mentioned users
    if (addedMentions.length > 0) {
      const user = await ctx.db.get(userId);
      await ctx.scheduler.runAfter(0, internal.taskNotifications.notifyUserMentions, {
        taskId: args.id,
        mentionedUserIds: addedMentions,
        taskTitle: task.title,
        mentionedBy: { name: user?.name ?? "Someone", id: userId },
        context: "task description",
      });
    }

    return null;
  },
});
```

### Notify on Mentions in Task Comments
```typescript
// Source: New pattern for comment mentions
export const createComment = mutation({
  args: {
    taskId: v.id("tasks"),
    body: v.string(), // BlockNote JSON
  },
  returns: v.id("taskComments"),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    // Extract mentions
    const mentionedUserIds = extractMentionedUserIds(args.body)
      .filter(id => id !== userId); // Don't notify self

    // Insert comment
    const commentId = await ctx.db.insert("taskComments", {
      taskId: args.taskId,
      userId,
      body: args.body,
      deleted: false,
    });

    // Notify mentioned users
    if (mentionedUserIds.length > 0) {
      const task = await ctx.db.get(args.taskId);
      const user = await ctx.db.get(userId);

      await ctx.scheduler.runAfter(0, internal.taskNotifications.notifyUserMentions, {
        taskId: args.taskId,
        mentionedUserIds,
        taskTitle: task?.title ?? "a task",
        mentionedBy: { name: user?.name ?? "Someone", id: userId },
        context: "comment",
      });
    }

    return commentId;
  },
});
```

### Internal Action: Send Mention Notifications
```typescript
// Source: New pattern, adapted from notifyTaskAssignment
export const notifyUserMentions = internalAction({
  args: {
    taskId: v.id("tasks"),
    mentionedUserIds: v.array(v.id("users")),
    taskTitle: v.string(),
    mentionedBy: v.object({
      name: v.string(),
      id: v.id("users"),
    }),
    context: v.union(v.literal("task description"), v.literal("comment")),
  },
  returns: v.null(),
  handler: async (ctx, { taskId, mentionedUserIds, taskTitle, mentionedBy, context }) => {
    const task = await ctx.runQuery(api.tasks.get, { id: taskId });
    if (!task) return null;

    const notification = JSON.stringify({
      title: `${mentionedBy.name} mentioned you`,
      body: `In ${context} for: ${taskTitle}`,
      data: {
        url: `/workspaces/${task.workspaceId}/projects/${task.projectId}?task=${taskId}`,
      },
    });

    // Setup VAPID (same as assignment)
    const subject = process.env.VAPID_SUBJECT;
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;

    if (!subject || !publicKey || !privateKey) {
      console.error("Missing VAPID environment variables");
      return null;
    }

    webpush.setVapidDetails(subject, publicKey, privateKey);

    // Get all mentioned users' subscriptions
    const subscriptions = await ctx.runQuery(api.pushSubscription.usersSubscriptions, {
      usersIds: mentionedUserIds,
    });

    // Send to all subscriptions
    await Promise.allSettled(
      subscriptions.map(async (subscription) => {
        const { endpoint, expirationTime, keys } = subscription;
        return webpush
          .sendNotification(
            { endpoint, expirationTime, keys },
            notification,
            { TTL: 10000, vapidDetails: { subject, publicKey, privateKey } }
          )
          .catch((error) => {
            console.error(`Push notification failed: ${error.message}`);
          });
      })
    );

    return null;
  },
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Polling for notifications | Web Push API | ~2015 (Chrome 42) | Native OS notifications, offline support |
| GCM (Google Cloud Messaging) | VAPID authentication | 2016 (RFC 8292) | Vendor-neutral, no Google dependency |
| Manual JWT signing | web-push library | Ongoing | Handles encryption, VAPID, retries |
| Immediate notification send | Scheduler pattern | Convex best practice | Ensures mutation succeeds before notification |
| Store @username strings | BlockNote inline content | Phase 5/6.1 | Type-safe user references, survives renames |

**Deprecated/outdated:**
- **GCM/FCM for web push**: VAPID is the standard, browser-native approach
- **Direct action calls from mutations**: Use scheduler for side effects
- **Regex parsing for @mentions**: BlockNote provides structured JSON

## Implementation Checklist

Task-level changes needed:

### Backend (Convex)
- [ ] Create `convex/taskNotifications.ts` with internal actions:
  - `notifyTaskAssignment` - for assignee changes
  - `notifyUserMentions` - for @mentions in descriptions/comments
- [ ] Create `convex/utils/blocknote.ts`:
  - `extractMentionedUserIds()` utility function
- [ ] Update `convex/tasks.ts`:
  - Add scheduler call to `create` mutation (assignee notification)
  - Add scheduler call to `update` mutation (assignee change detection)
  - Add scheduler call for description updates (mention detection)
- [ ] Update `convex/taskComments.ts`:
  - Add scheduler call to `create` mutation (mention detection)
  - Add scheduler call to `update` mutation (new mention detection)

### Frontend
- [ ] No changes needed - push notification infrastructure already exists
- [ ] Service worker already handles notification display and clicks
- [ ] Subscription management hook (`use-push-notifications`) already available

### Environment
- [ ] Verify VAPID environment variables exist:
  - `VAPID_SUBJECT` (mailto: or https: URL)
  - `VAPID_PUBLIC_KEY` (base64url-encoded)
  - `VAPID_PRIVATE_KEY` (base64url-encoded)

## Open Questions

1. **Notification Preferences**
   - What we know: No user preferences system exists yet
   - What's unclear: Should users be able to opt out of specific notification types?
   - Recommendation: Implement all-or-nothing first (opt in via push permission), add granular preferences in future phase

2. **Notification Batching**
   - What we know: Current implementation sends one notification per action
   - What's unclear: Should multiple mentions in one comment trigger one notification or multiple?
   - Recommendation: Send one notification per event (one for assignment, one for all mentions in a comment)

3. **Mention Detection on Comment Edit**
   - What we know: Pattern exists for task description mention detection
   - What's unclear: Should editing a comment to add @mention trigger notification?
   - Recommendation: Yes - use same diff pattern as task descriptions (only notify newly added mentions)

## Sources

### Primary (HIGH confidence)
- Existing codebase: `convex/pushNotifications.ts` - Complete web-push action pattern
- Existing codebase: `convex/pushSubscription.ts` - Subscription management
- Existing codebase: `convex/messages.ts` - Scheduler pattern for notifications
- Existing codebase: `src/hooks/use-push-notifications.tsx` - Frontend push subscription
- Existing codebase: `public/service-worker.js` - Push event handling
- Context7: `/llmstxt/convex_dev_llms_txt` - Scheduler and action patterns
- MDN Web Docs: [Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API) - Best practices
- npm: [web-push](https://www.npmjs.com/package/web-push) - Library documentation

### Secondary (MEDIUM confidence)
- [WebFetch: Push API Best Practices](https://developer.mozilla.org/en-US/docs/Web/API/Push_API) - Security requirements
- [BlockNote Document Structure](https://www.blocknotejs.org/docs/editor-basics/document-structure) - JSON traversal

### Tertiary (LOW confidence)
- WebSearch: Web push notification best practices 2026 - General guidance
- WebSearch: BlockNote JSON parsing 2026 - Community patterns

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already integrated and working
- Architecture: HIGH - Exact patterns exist for messages, need adaptation for tasks
- Pitfalls: HIGH - Based on existing implementation and web-push known issues

**Research date:** 2026-02-06
**Valid until:** 30 days (stable stack, proven patterns)
