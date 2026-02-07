---
phase: 10-inline-reply-to
plan: 02
subsystem: chat-ui
tags: [react, chat, reply-to, context-menu, composer, quote-preview]
requires: [10-01]
provides:
  - Reply context menu action on messages
  - Quote preview in composer when replying
  - Compact quote preview on sent replies
  - Deleted parent message placeholder
affects: [10-03]
tech-stack:
  added: []
  patterns:
    - context-based state management for reply mode
    - reusable quote preview component
    - mutually exclusive edit/reply modes
key-files:
  created:
    - src/pages/App/Chat/MessageQuotePreview.tsx
  modified:
    - src/pages/App/Chat/ChatContext.ts
    - src/pages/App/Chat/Chat.tsx
    - src/pages/App/Chat/Message.tsx
    - src/pages/App/Chat/MessageComposer.tsx
decisions:
  - slug: reply-edit-mutual-exclusion
    title: Reply and edit modes are mutually exclusive
    rationale: Entering reply mode clears edit mode and vice versa. This prevents confusing UI state where user might be both editing one message and replying to another. Simplifies UX and state management.
  - slug: no-nested-replies
    title: Reply action hidden on messages that are already replies
    rationale: Prevents nested reply chains (reply-to-a-reply). Quote preview provides context, and deeper nesting complicates threading UX. Can be revisited in future if threading becomes a requirement.
  - slug: compact-quote-variant
    title: Quote preview has compact variant for sent messages
    rationale: Composer quote needs full controls (cancel button), but sent message quotes should be minimal to reduce visual clutter in chat flow. Compact variant reduces padding and font size.
metrics:
  duration: 3.1 min
  completed: 2026-02-07
---

# Phase 10 Plan 02: Reply-to UI Implementation Summary

**One-liner:** Full reply-to UX with context menu action, composer quote preview with cancel, and compact quote display on sent replies.

## Overview

Implemented the complete reply-to user interface across chat components. Users can right-click non-deleted, non-reply messages to enter reply mode, which shows a quoted preview in the composer with a cancel button. Sending creates a reply message that displays with a compact quoted preview above the bubble. The system handles deleted parent messages gracefully with "[Message deleted]" placeholders. Reply and edit modes are mutually exclusive.

## What Was Built

### ChatContext Extension
- Added `ReplyingToMessage` type: `{ id, author, plainText } | null`
- Extended `ChatContextType` with `replyingTo` and `setReplyingTo`
- Reply state managed alongside existing edit state

### MessageQuotePreview Component (new)
Created reusable quote preview component with:
- **Null handling**: Shows "[Original message not found]" if parent doesn't exist
- **Deleted handling**: Shows "[Message deleted]" if parent is deleted
- **Normal display**: Shows author name and truncated text (100 char limit)
- **Optional cancel button**: Shown in composer mode (via `onCancel` prop)
- **Compact variant**: Smaller padding and fonts for sent message display
- **Visual styling**: Left border with primary color, muted background

### Message.tsx Updates
- **Reply action**: Added "Reply" context menu item with `CornerUpLeft` icon
  - Hidden on deleted messages
  - Hidden on messages that are already replies (no nesting)
- **handleReply**: Clears edit mode, enters reply mode with message data
- **handleEdit**: Updated to clear reply mode (mutual exclusivity)
- **Quote display**: Renders `MessageQuotePreview` above message bubble when `message.replyToId` exists

### MessageComposer.tsx Updates
- Added reply preview above formatting toolbar
- Shows quote with cancel button when `replyingTo` is set
- Cancel button calls `setReplyingTo(null)` to exit reply mode

### Chat.tsx Updates
- Added `replyingTo` state alongside `editingMessage`
- Updated `ChatContext.Provider` value to include reply state
- Modified `handleSubmit` to:
  - Include `replyToId: replyingTo.id` when in reply mode
  - Clear reply state after successful send

## Key Architectural Decisions

**Reply and edit modes are mutually exclusive**
Entering reply mode clears any active edit, and entering edit mode clears any active reply. This prevents confusing UI states and simplifies the user mental model. Both modes use the same composer area, so only one can be active at a time.

**No nested replies (reply-to-a-reply)**
The Reply action is hidden on messages that are already replies. This prevents reply chains from nesting deeply, which would complicate threading UX. The quote preview already provides context, and deeper threading can be added in a future phase if needed.

**Compact quote variant for sent messages**
The quote preview component has a `compact` prop that reduces padding and font sizes. Composer quotes need full controls (cancel button), but sent message quotes should be minimal to avoid cluttering the chat flow. The compact variant strikes this balance.

## Task Commits

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | Extend ChatContext and create MessageQuotePreview | 6853037 | ChatContext.ts, MessageQuotePreview.tsx |
| 2 | Wire reply mode through Chat, Message, MessageComposer | d61fb2f | Chat.tsx, Message.tsx, MessageComposer.tsx |

## Deviations from Plan

None - plan executed exactly as written.

## Blockers/Issues Discovered

None.

## Next Phase Readiness

**Ready for 10-03 (optional final polish/testing phase):** The reply-to feature is fully functional. Users can:
- Right-click any non-deleted, non-reply message → see "Reply" action
- Click Reply → composer shows quoted preview with cancel button
- Send message → creates reply with compact quote above bubble
- View replies → see author and text of parent message
- Handle edge cases → deleted parents show "[Message deleted]", missing parents show "[Original message not found]"

**Feature complete:**
- Reply context menu action ✓
- Composer quote preview with cancel ✓
- Sent reply quote display ✓
- Deleted parent placeholder ✓
- Mutual exclusivity with edit mode ✓
- Backend replyToId integration ✓

**Quality checks passed:**
- TypeScript compilation clean ✓
- ESLint with 0 warnings ✓
- Production build succeeds ✓

## Testing Notes

To verify end-to-end:
1. Start dev server: `npm run dev`
2. Navigate to any channel with messages
3. Right-click a message → should see "Reply" option (with corner-up-left icon)
4. Click Reply → composer should show quote preview with author, text, and X button
5. Type a message and send → should see new message with compact quote above it
6. Delete the parent message
7. Refresh → reply should show "[Message deleted]" in quote
8. Try to reply to a message that is already a reply → should NOT see Reply option

**Mutual exclusivity test:**
1. Click Edit on a message → composer loads edit content
2. Right-click another message and click Reply → edit should clear, reply preview should show
3. Click Reply on a message
4. Click Edit on another message → reply should clear, edit content should load

## Self-Check: PASSED

All key files exist:
- src/pages/App/Chat/MessageQuotePreview.tsx ✓
- src/pages/App/Chat/ChatContext.ts ✓
- src/pages/App/Chat/Chat.tsx ✓
- src/pages/App/Chat/Message.tsx ✓
- src/pages/App/Chat/MessageComposer.tsx ✓

All commits exist:
- 6853037 ✓
- d61fb2f ✓
