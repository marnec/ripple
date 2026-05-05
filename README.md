NEXT STEPS:
- calendar; plan calls; invite guests

- leave channel logic (only for private?)
- consider favorite for channels too

- import tasks from csv

- external ticketing system: 
    - connected to project
    - connected somehow to tasks
    - external ticketer can be given access to specific resources in workspaces through links (attach to ticket??)

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



- tag system follow-ups
    - [ ] cycle-scoped tag filter — `taskTags` already has room for a `[cycleId, tagId]` index when needed

- task query scaling
    - [ ] cross-workspace overflow on `listByAssignee` for heavy users with assignments across many workspaces
    - [ ] kanban active-backlog overflow strategy when a project's uncompleted set grows past the read cap
    - [ ] `AddTasksToCycleDialog` "show completed too" toggle if users request it
