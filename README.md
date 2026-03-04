NEXT STEPS:
- tasks
    - [ ] mytasks??

- investigate rework all deletion cascade to soft-deletion with scheduled garbage collection

- [ ] there is still a problem sometimes with the in-call follow action not working

- [ ] link previews in chat

- knowledge-graph
    - [x] add document-paragraph embeds in tasks and other docs (similar mechanism to spreadsheet range, use block id, show referenced blocks)
    - [x] improve spreadsheet reference highlight (border)
    - [ ] add a backlink section that shows cross-references (this might be harder than it seems)

keyboard accessiblity
    - [ ] command palette
    - [ ] focus traps
    - [ ] chat image focus escape with "esc" key too

- [x] profile settings saved to local storage
    - [x] move theme settings to profile settings
    - [x] user notification settings
    - [x] language preference
    - [x] restore last search on resource-list page from local-storage

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
