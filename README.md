NEXT STEPS:
- tasks
    - [x] fix layout shift when facepile appears
    - [x] add load optimization and fade-in to taskdetailspage
    - [ ] mytasks??
    - [x] PLANE.so inspired cycles

- investigate rework all deletion cascade to soft-deletion

resource-list
    - [ ] fix favorite user journey from sidebar (add filter non-favorites, link opens that filter)
    - [ ] improve tag search
    - [ ] improve resource item card (click anywhere to navigate, more info displayed)

- excalidraw
    - [ ] remove zoom and history controls
    - [ ] fix facepile overlap native controls in mobile view
    - [ ] uniform to standard resource page layout

- knowledge-graph
    - [ ] add document-paragraph embeds in tasks and other docs (similar mechanism to spreadsheet range, use block id, show referenced blocks)
    - [ ] improve spreadsheet reference highlight (border)
    - [ ] add a backlink section that shows cross-references


keyboard accessiblity
    - [ ] command palette
    - [ ] focus trap

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
    - [x] migrate abandoded partykit to the new worker version
    - [x] partykit optimization for docs with embeds: vehicule all updates in room channel also for embedded resources, so that a document needs to listen to just a single room
    - [x] optimize get collaboration token being called way too much (HMAC-signed tokens, no DB round-trip)
    - [ ] share presence connection across tabs (BroadcastChannel/SharedWorker)
    - [ ] deduplicate token requests per resource across tabs

- convex query optimization
    - [ ] batch favorites.listIdsForType into single listAllForWorkspace query
    - [ ] batch breadcrumb.getResourceName into single getResourceNames(ids[]) query

- spreadsheet qol
    - [ ] improve formula picker to trigger for nested functions
    - [ ] prompt for coordinates
    - [ ] mouse pick coords?
    - [ ] reintroduce formatting?

- [ ] user avatars: look at dicebear

- [ ] evaluate switch to pragmatic drag and drop for total control and integration with view-transition-apis