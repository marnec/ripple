NEXT STEPS:

- filter tasks by tag

- remove tag project association

- show raw content of a cell in spreadsheet (for formulas)

- import diagrams from excalidraw file

- calendar; plan calls; invite guests

- unify resource tags and task labels

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
    - [ ] run `migrateTaskEntityTagsToTaskTags` on prod once it soaks, then drop the `task` literal from `entityTags.resourceType` union
    - [ ] extend the taskTags-driven server-side tag filter to `listByWorkspace` and `listByAssignee` for cross-project tag queries
    - [ ] cycle-scoped tag filter — `taskTags` already has room for a `[cycleId, tagId]` index when needed
    - [ ] tagged-active server-side filter (active path currently client-side; the `by_project_tag_completed` index already supports it)

- task query scaling
    - [ ] cross-workspace overflow on `listByAssignee` for heavy users with assignments across many workspaces
    - [ ] kanban active-backlog overflow strategy when a project's uncompleted set grows past the read cap
    - [ ] real fix when the project list truncation banner fires regularly — archive table, per-cycle scoping, or paginated completed view
    - [ ] `AddTasksToCycleDialog` "show completed too" toggle if users request it

- resource list page scaling
    - [ ] anti-favorite (`isFavorite=false`) currently post-filters the default branch — switch to indexed when it becomes a hot path
