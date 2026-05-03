NEXT STEPS:

Priorities:
- DOC: Ctrl+Z does not trigger undo in the document editor (BlockNote + Yjs collaboration); investigate Y.UndoManager trackedOrigins / y-prosemirror keymap wiring
- Investigate what happens to referenced cells when inserting or removing rows or columns  
- When adding a new task in the kanban, sometimes a task card can acquire focus showing an ugly focus rectangle border around it. Same thing might happen when closing a task details sheet.
- there is no way to cancel message editing and it's unclear when editing vs when composing


- leave channel logic

- what happens to tasks when a column (status is deleted)?

- calendar; plan calls; invite guests

- [ ] link previews in chat

- knowledge-graph
    - [ ] explore pdf reading, annotation and embedding

keyboard accessiblity
    - [ ] focus traps

- [ ] internationalization (i18n and localization)

- [ ] AI integrations
    - [ ] AI bot in chat (called on mention)
    - [ ] AI dictate content
    - [ ] AI translations in videocalls
    - [ ] AI agent in videocall (unclear how)
    - [ ] AI document agent
    - [ ] AI tasks agent

- [ ] External integrations
    - [ ] github issues
    - [ ] add sentry

- partykit
    - [ ] share presence connection across tabs (BroadcastChannel/SharedWorker)
    - [ ] deduplicate token requests per resource across tabs

- avatars:
    - [ ] user custom avatars: look at dicebear
    - [ ] facepile not using user avatar (investigate convex cost)

- [ ] evaluate switch to pragmatic drag and drop for total control and integration with view-transition-apis

- spreadsheet qol
    - [ ] improve formula picker to trigger for nested functions
    - [ ] prompt for coordinates
    - [ ] mouse pick coords?
    - [ ] reintroduce formatting?

- tag system follow-ups
    - [ ] cycle-scoped tag filter — `taskTags` already has room for a `[cycleId, tagId]` index when needed

- task query scaling
    - [ ] cross-workspace overflow on `listByAssignee` for heavy users with assignments across many workspaces
    - [ ] kanban active-backlog overflow strategy when a project's uncompleted set grows past the read cap
    - [ ] `AddTasksToCycleDialog` "show completed too" toggle if users request it
