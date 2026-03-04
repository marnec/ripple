NEXT STEPS:
- tasks
    - [ ] mytasks??

- investigate rework all deletion cascade to soft-deletion with scheduled garbage collection

- [x] diagram and spreadsheet embeds in blocknote editor should not be resizeable in mobile, thy should take full width and not influence block-stored desktop width

- [x] fix spreadsheet embed resize (remove resizeable cols, only leave block resize)

- [x] in mobile docs blocks should take full width and should not be dragged (hide drag, plus icon)

- [x] when deleting embed show alert dialog / drawer (this edit cannot be undone) or alternatively add toast that allows to manually undo the action for a period of time

- [ ] there is still a problem sometimes with the in-call follow action not working

- [ ] link previews in chat

- knowledge-graph
    - [x] add document-paragraph embeds in tasks and other docs (similar mechanism to spreadsheet range, use block id, show referenced blocks)
    - [x] improve spreadsheet reference highlight (border)
    - [ ] add a backlink section that shows cross-references

keyboard accessiblity
    - [ ] command palette
    - [ ] focus traps
    - [ ] chat image focus escape with "esc" key too

- [ ] profile settings saved to local storage
    - [ ] move theme settings to profile settings
    - [ ] user notification settings
    - [ ] language preference
    - [ ] restore last search on resource-list page from local-storage

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

- spreadsheet qol
    - [ ] improve formula picker to trigger for nested functions
    - [ ] prompt for coordinates
    - [ ] mouse pick coords?
    - [ ] reintroduce formatting?

- avatars:
    - [ ] user custom avatars: look at dicebear
    - [ ] facepile not using user avatar (investigate convex cost)
    - [ ] fix workspace avatar being squashed on closed sidebar

- [ ] evaluate switch to pragmatic drag and drop for total control and integration with view-transition-apis