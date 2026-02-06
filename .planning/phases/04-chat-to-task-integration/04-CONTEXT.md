# Phase 4: Chat-to-Task Integration - Context

**Gathered:** 2026-02-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Create tasks from chat messages with context capture, and show inline task previews in chat. Users can right-click a message to create a task, mention tasks with # syntax in messages, and see live-updating task chips inline. Creating tasks, task CRUD, and task properties are handled by Phase 2 — this phase builds the bridge between chat and tasks.

</domain>

<decisions>
## Implementation Decisions

### Task creation flow
- Trigger: right-click context menu on a message ("Create task from message" option)
- UX: quick popover near the message with title pre-filled, project picker, and Create button — minimal friction
- Title pre-fill: first line of message text, truncated to ~80 chars if long
- Project selection: auto-select the channel's linked project if one exists, otherwise show a project picker dropdown

### Context capture
- Scope: just the single right-clicked message — no surrounding thread context
- Storage: message content goes into the task's BlockNote description field (rich text preserved)
- No backlink: no sourceMessageId field — the description content is sufficient
- Chat feedback: a system message appears in chat after task creation ("Alice created a task from this message") with a link/reference to the created task

### Inline task previews
- Appearance: compact inline chip/badge that flows with the message text
- Content: colored status dot + truncated task title only (no assignee avatar)
- Click behavior: navigates to the project task view with the task selected/highlighted
- Live updates: status dot updates in real-time via Convex reactivity as task status changes

### Task mention syntax
- Trigger character: # opens an autocomplete dropdown
- Scope: shows tasks from the current channel's linked project; if no linked project, show all user's tasks
- Search: fuzzy search by task title as user types after #
- Result: selected task is inserted as an inline chip in the message

### Claude's Discretion
- Autocomplete dropdown styling and positioning
- System message format and wording
- How message content is converted to BlockNote format
- Popover positioning and responsive behavior
- Handling of edge cases (deleted tasks in mentions, permissions)

</decisions>

<specifics>
## Specific Ideas

- Context menu follows existing right-click patterns in the chat UI
- Task chip should feel native to the chat text — not disruptive, like a styled inline element
- System message pattern should match any existing system messages in chat (joins, leaves, etc.)
- # autocomplete should feel similar to @ mention autocomplete if one exists

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-chat-to-task-integration*
*Context gathered: 2026-02-06*
