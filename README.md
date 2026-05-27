NEXT STEPS:

- calendar; plan calls; invite guests
    - ics accept/decline sync with ripple invitation status; we need to deploy in order to test this
    - recurrent events

- I don't really know how to handle unread messages, they kind of work right now but god save me

- Deferred: dev panel on the task (branch/commits/PR/CI checks inline, à la Linear/Jira)

- surface error to users when tying to manually set triage status


- add to tak header github linked issue (github lgo separator)

- split settings in tabs (workspace and projects)

- restyle graph https://d3js.org/d3-force

- on "@ripple/convex:dev: 5/26/2026, 9:54:29 AM [CONVEX M(auth:store)] [INFO] '`auth:store` type: refreshSession'" the whole app seems to reload

- document comments (https://www.blocknotejs.org/docs/features/collaboration/comments)
- guests can comment (all viewers?)

- knowledge-graph
    - explore pdf reading, annotation and embedding

- external ticketing system??: 
    - connected to project
    - connected somehow to tasks
    - external ticketer can be given access to specific resources in workspaces through links (attach to ticket??)

- [ ] link previews in chat

keyboard accessiblity
    - focus traps

- [ ] internationalization (i18n and localization)

- [ ] AI integrations
    - [ ] AI bot in chat (called on mention)
    - [ ] AI dictate content
    - [ ] AI transcription in videocalls
    - [ ] AI agent in videocall (unclear how to handle diarization)
    - [ ] AI document agent
    - [ ] AI tasks agent

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


- [ ] External integrations
    - [ ] github issues
        - v1 deferrals (revisit after first ship):
            - [ ] milestone ↔ cycle sync (opt-in, name-paired via stored `externalMilestoneId`)
            - [ ] priority sync via configurable label template (e.g. `priority/high`)
            - [ ] internal-only task comments (`taskComments.internal` flag; not pushed to GitHub, never set on inbound)
    - [ ] add sentry

- identity model refactor
    - [ ] split `users` (auth-only) from a new `profiles` table that can host synthetic / bot identities (integration bots, system actors); `creatorId`/`assigneeId`/`userId` refs point at `profiles`. Lets integrations create non-auth identities without polluting the auth surface.