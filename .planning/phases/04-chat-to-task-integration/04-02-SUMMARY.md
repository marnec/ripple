---
phase: "04"
plan: "02"
subsystem: "chat-task-integration"
tags: ["chat", "tasks", "mentions", "autocomplete", "blocknote"]
requires: ["04-01", "03-03", "02-04", "01-04"]
provides: ["task-mentions-in-chat", "task-chip-rendering", "live-task-status-updates"]
affects: ["05-advanced-task-features"]
tech-stack:
  added: []
  patterns: ["blocknote-inline-content", "html-parsing-for-react-components", "scoped-autocomplete"]
key-files:
  created:
    - "src/pages/App/Chat/CustomInlineContent/TaskMention.tsx"
    - "src/pages/App/Chat/TaskMentionChip.tsx"
  modified:
    - "src/pages/App/Chat/MessageComposer.tsx"
    - "src/pages/App/Chat/Message.tsx"
    - "src/pages/App/Chat/Chat.tsx"
key-decisions:
  - decision: "Store both taskId and taskTitle in inline content props for editor performance"
    rationale: "Avoids Convex queries during editor typing, taskTitle used for preview, taskId for live chip post-send"
    impact: "Editor remains fast, live updates only occur in sent messages"
  - decision: "Parse HTML and replace task mention spans with React components"
    rationale: "BlockNote serializes to HTML, need to hydrate spans back to React for live updates"
    impact: "Task chips have full React context access, can use useQuery for real-time status"
  - decision: "Scope autocomplete to linked project tasks or all user tasks"
    rationale: "If channel has linked project, show project tasks. Otherwise show all user's tasks across workspace"
    impact: "Context-aware autocomplete, users see relevant tasks for current conversation"
  - decision: "Include status dot in autocomplete dropdown items"
    rationale: "Visual status indicator helps users identify tasks at a glance"
    impact: "Better UX, matches task chip rendering style"
duration: "3 min"
completed: "2026-02-06"
---

# Phase 4 Plan 2: Task Mentions in Chat Summary

**One-liner:** Users can type # in chat to mention tasks with live-updating status chips that navigate to projects on click.

## Performance

**Duration:** 3 minutes
**Tasks completed:** 2/2
**Commits:** 2

## Accomplishments

Successfully added task mention functionality to chat messages with # autocomplete trigger:

1. **TaskMention inline content spec** - BlockNote custom inline content for editor-time task chip preview
2. **TaskMentionChip component** - Live-updating React component for sent messages with real-time status dots
3. **# autocomplete** - SuggestionMenuController showing tasks with status indicators, scoped to linked project or all user tasks
4. **HTML parsing for React hydration** - Parse sent message HTML to replace task mention spans with interactive React components
5. **Click-to-navigate** - Task chips navigate to project page with highlightTaskId state for future highlighting

## Task Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | d2b33f2 | Add TaskMention inline content spec and TaskMentionChip component |
| 2 | c218a42 | Add # autocomplete for task mentions in message composer |

## Files Created

1. **src/pages/App/Chat/CustomInlineContent/TaskMention.tsx** - BlockNote inline content spec
   - Lightweight editor preview (no live queries)
   - Stores taskId + taskTitle in props
   - Renders static chip with gray dot during composition

2. **src/pages/App/Chat/TaskMentionChip.tsx** - Live-updating task chip
   - useQuery(api.tasks.get) for real-time status updates
   - Click handler navigates to project page
   - Graceful fallback for deleted tasks (#deleted-task)

## Files Modified

1. **src/pages/App/Chat/MessageComposer.tsx**
   - Added TaskMention to BlockNote schema inlineContentSpecs
   - Added SuggestionMenuController for # trigger
   - Query projects to find linked project for autocomplete scoping
   - Query tasks (listByProject or listByAssignee based on linked project)
   - Autocomplete shows max 10 tasks with status dot icons
   - Insert taskMention inline content on selection

2. **src/pages/App/Chat/Message.tsx**
   - Added parseMessageContent function to extract task mentions from HTML
   - useMemo to parse segments (html chunks + taskMention markers)
   - Render segments with SafeHtml for text + TaskMentionChip for tasks
   - Wrapped in div instead of direct SafeHtml to support mixed content

3. **src/pages/App/Chat/Chat.tsx**
   - Pass channelId and workspaceId props to MessageComposer
   - Cast workspaceId from params to Id<"workspaces">

## Decisions Made

**1. Dual-property inline content (taskId + taskTitle)**
- Store both taskId and taskTitle in BlockNote props
- Editor preview uses taskTitle (no Convex queries during typing)
- Sent messages use taskId for live TaskMentionChip queries
- **Impact:** Fast editor performance, real-time updates only where needed

**2. HTML parsing for React component hydration**
- BlockNote serializes to HTML on send via blocksToFullHTML
- Parse HTML to find task-mention spans with data-task-id attributes
- Replace spans with React TaskMentionChip components
- **Impact:** Full React context for task chips, enables useQuery for live updates

**3. Scoped autocomplete logic**
- If channel has linked project: show project tasks only
- If no linked project: show all user's tasks in workspace
- Use listByProject vs listByAssignee query accordingly
- **Impact:** Context-aware suggestions, reduces cognitive load

**4. Status dot in autocomplete**
- Each autocomplete item shows colored dot matching task status
- Uses same color system as kanban columns
- **Impact:** Visual consistency, users recognize task state immediately

**5. Click-to-navigate with state**
- Task chips navigate to /workspaces/:id/projects/:id
- Pass highlightTaskId in React Router state
- **Impact:** Enables future task highlighting feature, maintains context

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

**1. ESLint floating promise warning for navigate()**
- **Issue:** TypeScript linter flagged navigate call as potential promise
- **Resolution:** Added `void` prefix to navigate call in TaskMentionChip
- **Classification:** Rule 1 (Bug) - auto-fixed
- **Impact:** Lint passes cleanly

## Next Phase Readiness

**Ready for Phase 5 (Advanced Task Features):** Yes

**Blockers:** None

**Recommendations:**
- Task mention chips currently pass highlightTaskId state but highlighting not yet implemented
- Consider adding task mention notifications in Phase 5 (mention author gets notified)
- Consider adding @-mention support for users in chat (follows same pattern as documents)

**Dependencies satisfied:**
- 04-01 (task creation from messages) - provides CreateTaskFromMessagePopover
- 03-03 (column management) - provides status colors for chips
- 02-04 (task detail sheet) - provides task.get query for live data
- 01-04 (project members) - provides project membership validation

**What this enables:**
- Tasks can be referenced in conversations
- Live status visibility in chat history
- Quick navigation from chat to project context
- Foundation for task mention notifications (Phase 5+)

## Self-Check: PASSED
