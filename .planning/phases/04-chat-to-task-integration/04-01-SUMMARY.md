---
phase: 04-chat-to-task-integration
plan: 01
subsystem: chat-tasks-integration
tags: [chat, tasks, context-menu, blocknote, convex]
requires:
  - 02-basic-tasks (task creation mutation)
  - 01-projects-foundation (project-channel linking)
provides:
  - Task creation from chat messages
  - Message content capture as task description
  - Channel-to-project lookup
  - System message feedback in chat
affects:
  - 04-02-link-to-task (will need to integrate with system messages)
tech-stack:
  added: []
  patterns:
    - Right-click context menu for message actions
    - Popover-based quick creation form
    - BlockNote HTML to JSON conversion for content capture
    - System messages for action feedback
key-files:
  created:
    - src/pages/App/Chat/CreateTaskFromMessagePopover.tsx
  modified:
    - convex/projects.ts
    - src/pages/App/Chat/Message.tsx
    - src/pages/App/Chat/Chat.tsx
key-decisions:
  - decision: Context menu available to all users, but edit/delete only for author
    rationale: Any user should be able to create tasks from messages, not just the author
    alternatives: Could restrict to message author only
  - decision: Split popover into content component to avoid setState in effect
    rationale: Avoids lint errors and follows React best practices for component remounting
    alternatives: Could use useEffect with proper dependencies
  - decision: System message uses italic muted style with emoji
    rationale: Distinguishes from regular messages while being informative
    alternatives: Could use toast-only or separate UI element
  - decision: Auto-select linked project when available
    rationale: Most common case is creating task in the project's discussion channel
    alternatives: Could always require manual selection
duration: 4 min
completed: 2026-02-06
---

# Phase 04 Plan 01: Task Creation from Message Summary

**One-liner:** Right-click any chat message to create a task with captured content, auto-selecting channel's linked project.

## Performance

**Execution time:** 4 minutes (13:41:16 - 13:45:44 UTC)

**Key metrics:**
- 2 tasks completed atomically
- 4 files modified (1 created, 3 updated)
- 2 commits (1 per task)
- 0 deviations from plan

## Accomplishments

### Backend Query (Task 1)
Added `getByLinkedChannel` query to enable reverse lookup from channel to project:
- Finds project with matching `linkedChannelId`
- Validates user has project membership
- Returns null if no match or no access
- Uses filter on workspace projects (acceptable scale <100 per workspace)

### Context Menu & Popover (Task 2)
Implemented full task creation flow from chat messages:
- **CreateTaskFromMessagePopover component:**
  - Title pre-filled from message first line (max 80 chars)
  - Project dropdown with auto-selection if linked project exists
  - Converts message HTML to BlockNote JSON for task description
  - Toast notification on success/failure
  - Split into content component to avoid React useEffect anti-pattern
- **Message.tsx updates:**
  - Context menu now enabled for all users (removed `disabled` prop)
  - Edit/Delete items conditionally shown only for message author
  - "Create task from message" item available to all users
  - Renders popover when isCreatingTask state is true
  - Added channelId, workspaceId, onTaskCreated props
- **Chat.tsx updates:**
  - Extracts workspaceId from URL params
  - Passes channelId and workspaceId to Message components
  - handleTaskCreated sends system message with task title
  - System message format: italic, muted, with 📋 emoji

## Task Commits

1. **7740543** - `feat(04-01): add getByLinkedChannel query`
   - Added projects.getByLinkedChannel query
   - Enables channel-to-project reverse lookup
   - Validates user membership before returning

2. **7cbc1d2** - `feat(04-01): create task from message via context menu`
   - CreateTaskFromMessagePopover component
   - Message.tsx context menu for all users
   - Chat.tsx system message integration
   - BlockNote HTML-to-JSON conversion

## Files Created

### src/pages/App/Chat/CreateTaskFromMessagePopover.tsx
Quick task creation popover with:
- Title input (pre-filled from message)
- Project selector (auto-selects linked project)
- Create button with loading state
- BlockNote schema matching MessageComposer for HTML parsing
- Split component pattern to avoid useEffect anti-pattern

## Files Modified

### convex/projects.ts
- Added `getByLinkedChannel` query for reverse channel-to-project lookup

### src/pages/App/Chat/Message.tsx
- Added channelId, workspaceId, onTaskCreated props
- Context menu enabled for all users
- Conditional rendering of edit/delete for author only
- "Create task from message" menu item for everyone
- State management for popover open/close

### src/pages/App/Chat/Chat.tsx
- Extract workspaceId from URL params
- Pass channelId/workspaceId to Message components
- handleTaskCreated sends system message with task info
- System message HTML formatting with muted style

## Decisions Made

1. **Context menu accessibility:** Enabled for all users, not just message author
   - Rationale: Task creation is a team collaboration feature
   - Impact: Better UX for capturing action items from any conversation

2. **Component splitting pattern:** CreateTaskFromMessagePopover split into wrapper + content
   - Rationale: Avoid setState in useEffect by remounting content on open
   - Impact: Cleaner React pattern, passes lint rules without workarounds

3. **System message format:** Italic, muted text with emoji
   - Rationale: Visually distinct from regular messages but integrated in flow
   - Impact: Users see confirmation without leaving chat context

4. **Auto-selection logic:** Linked project pre-selected when available
   - Rationale: 90% use case is creating task in project's discussion channel
   - Impact: Faster task creation with fewer clicks

## Deviations from Plan

None - plan executed exactly as written.

## Technical Notes

### BlockNote Schema Reuse
Used same schema as MessageComposer (`remainingBlockSpecs` without audio/image/heading) for consistent HTML parsing. This ensures message content converts cleanly to BlockNote JSON format.

### React Hooks Pattern
Initially hit lint error for setState in useEffect. Resolved by:
1. Splitting into CreateTaskFromMessagePopoverContent component
2. Conditionally rendering content only when `open={true}`
3. Component remounts on each open, getting fresh initial state
4. No effects needed - uses useState initial value and useMemo

### System Message Implementation
System messages use the same `messages.send` mutation as regular messages:
- HTML body with inline styles (`text-muted-foreground`, `italic`)
- PlainText version for accessibility
- Generated isomorphicId via `crypto.randomUUID()`
- No special message type - just styled differently

## Issues Encountered

None.

## Next Phase Readiness

**Phase 04 Plan 02 (Link to Task):** Ready to proceed.

**Blockers:** None

**Concerns:** Plan 04-02 will modify Message.tsx and MessageComposer.tsx. As noted in execution context, 04-02 owns MessageComposer.tsx. No conflicts expected with Message.tsx changes from this plan.

**Integration points for 04-02:**
- Message component now has context menu pattern established
- System messages pattern available for task link confirmations
- BlockNote schema reuse established for consistent editor behavior

## Self-Check: PASSED

**Files created:**
✓ src/pages/App/Chat/CreateTaskFromMessagePopover.tsx

**Commits verified:**
✓ 7740543 - feat(04-01): add getByLinkedChannel query
✓ 7cbc1d2 - feat(04-01): create task from message via context menu
