NEXT STEPS:
- investigate rework all deletion cascade to soft-deletion with scheduled garbage collection (also investigate n+1 problem and analyze submitted component for cascading delete)

- [ ] there is still a problem sometimes with the in-call follow action not working

- [x] extend audit-log usage

- [ ] link previews in chat

- [x] fix acknowledged deletion

- [x] restyle workspace home page, remove skeletons, add fade-in, add missing cards, evaluate if resource lists make sense or other informations are better

- [x] add navigation to access settings of various things

- knowledge-graph
    - [ ] add task description embedding in tasks (auto add relates-to relationship)
    - [ ] add table embedding in tasks
    - [ ] explore pdf reading, annotation and embedding
    - [ ] add a obsidian style backlinks to resources (this might be harder than it seems)

keyboard accessiblity
    - [ ] command palette
    - [ ] focus traps
    - [ ] chat image focus escape with "esc" key too

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
    - [ ] fix workspace avatar being squashed on closed sidebar

- [ ] evaluate switch to pragmatic drag and drop for total control and integration with view-transition-apis

- spreadsheet qol
    - [ ] improve formula picker to trigger for nested functions
    - [ ] prompt for coordinates
    - [ ] mouse pick coords?
    - [ ] reintroduce formatting?
