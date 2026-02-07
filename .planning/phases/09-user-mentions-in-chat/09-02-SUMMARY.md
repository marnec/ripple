---
phase: 09
plan: 02
subsystem: chat-notifications
tags: [chat, mentions, push-notifications, convex-actions, webpush]

requires:
  - 06.1-mention-people-in-task-comments (UserMention component, extractMentionedUserIds utility)
  - 07-notifications-and-polish (taskNotifications pattern, webpush infrastructure)

provides:
  - Chat-specific mention notifications ("mentioned you in #channelName")
  - Self-mention filtering in messages.send
  - No edit notification spam (messages.update unchanged)

affects:
  - 09-01-user-mentions-ui (frontend will trigger these notifications when @mentions are sent)

tech-stack:
  added: []
  patterns:
    - Chat-specific notification actions (chatNotifications.ts)
    - Mention extraction in message mutations
    - Self-mention filtering pattern

key-files:
  created:
    - convex/chatNotifications.ts
  modified:
    - convex/messages.ts

decisions:
  - decision: Remove messageId parameter from chatNotifications action
    rationale: Pass plainText directly instead of querying message - simpler and avoids creating messages.getById query
    impact: Notification body shows message preview without additional query overhead
    tags: [performance, simplification]

  - decision: Only notify on message create, not update
    rationale: Phase 07.2 diff-based approach for tasks is complex; v1 chat keeps it simple by only notifying on new messages
    impact: Users won't be spammed with duplicate notifications when messages are edited
    tags: [ux, scope-reduction]

  - decision: Keep channel-level and mention notifications separate
    rationale: Both serve different purposes - channel notifies all members, mention notifies specific users
    impact: Two notifications can fire for the same message (one channel-level, one mention-specific)
    tags: [architecture, notifications]

metrics:
  duration: 3.9 min
  completed: 2026-02-07
---

# Phase 09 Plan 02: Chat Mention Notifications Backend Summary

Push notifications for @mentions in chat messages with channel context.

## One-liner

Chat mention push notifications via chatNotifications.ts internalAction, scheduled from messages.send with self-mention filtering and plainText preview.

## What Was Built

### New Files

**convex/chatNotifications.ts** (89 lines)
- `notifyMessageMentions` internalAction following taskNotifications.ts pattern
- Notification title: `"${mentionedBy.name} mentioned you in #${channel.name}"`
- Body: truncated plainText (100 char limit) for message preview
- VAPID credentials from env vars (VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
- Promise.allSettled for reliable multi-user notification delivery
- Error logging for missing channels or VAPID credentials

### Modified Files

**convex/messages.ts**
- Added imports: `internal` from `_generated/api`, `extractMentionedUserIds` from `utils/blocknote`
- Updated `messages.send` mutation:
  - Extract mentions from body: `extractMentionedUserIds(body)`
  - Filter self-mentions: `mentionedUserIds.filter(id => id !== userId)`
  - Schedule chatNotifications.notifyMessageMentions when mentions exist
  - Existing channel-level pushNotification remains unchanged (both fire)
- `messages.update` unchanged (no edit notifications per v1 design)

## Task Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | c285355 | Create chatNotifications.ts action |
| 2 | 52abb2a | Wire messages.send to schedule mention notifications |

## Verification Results

✅ All success criteria met:

1. ✅ `npm run lint` passes with zero warnings
2. ✅ `npm run build` succeeds
3. ✅ chatNotifications.ts exists with notifyMessageMentions internalAction
4. ✅ messages.send extracts mentions, filters self, schedules notifications
5. ✅ messages.update does NOT extract mentions or send notifications
6. ✅ Notification title format: "AuthorName mentioned you in #channelName"
7. ✅ Self-mentions filtered: `mentionedUserIds.filter(id => id !== userId)`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed messageId parameter from chatNotifications action**
- **Found during:** Task 1 implementation
- **Issue:** Plan specified messageId parameter but we pass plainText directly, making messageId unused
- **Fix:** Removed messageId from args and handler signature
- **Files modified:** convex/chatNotifications.ts
- **Commit:** c285355

**Why this is better:** Simpler API, avoids unused parameters, and achieves same result (message preview in notification body) without needing to query the message by ID.

## Integration Points

### Upstream Dependencies
- **convex/utils/blocknote.ts**: `extractMentionedUserIds` utility (from Phase 06.1)
- **convex/taskNotifications.ts**: Notification action pattern (from Phase 07)
- **convex/pushNotifications.ts**: Webpush infrastructure and VAPID setup

### Downstream Consumers
- **src/pages/App/Chat/MessageComposer.tsx** (modified by parallel 09-01): Will send messages with userMention inline content
- **Frontend BlockNote editor**: User types @username, creates userMention node, sends to messages.send

### Data Flow
```
User types @mention in MessageComposer
  → BlockNote creates userMention inline content node
  → messages.send receives body with userMention JSON
  → extractMentionedUserIds parses JSON for user IDs
  → Filter out self-mentions
  → Schedule chatNotifications.notifyMessageMentions
  → Action queries channel, builds notification, sends via webpush
  → Mentioned users receive push notification
```

## Next Phase Readiness

### Blockers
None. Backend infrastructure ready for 09-01 frontend integration.

### Warnings
1. **Parallel execution coordination**: Plan 09-01 (executed in parallel) modifies frontend files. Both plans must complete before testing end-to-end @mention notifications.
2. **VAPID credentials required**: Push notifications require VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY env vars in production.

### Required Follow-up
None. Plan complete.

### Risks
- **Notification spam**: Since both channel-level and mention-level notifications fire, users might receive two notifications for messages that @mention them. Consider this when evaluating in production.
- **No batching**: If message mentions 10 users, 10 separate notification jobs are sent. This is acceptable for v1 but consider batching if performance issues arise.

## Self-Check: PASSED

Created files verified:
- ✅ convex/chatNotifications.ts exists

Commits verified:
- ✅ c285355 exists in git log
- ✅ 52abb2a exists in git log

Implementation verified:
- ✅ messages.send has mention extraction logic
- ✅ messages.update unchanged (no edit notifications)
- ✅ Self-mention filter present
- ✅ Both channel-level and mention-level notifications scheduled
