NEXT STEPS:

- calendar; plan calls; invite guests
    - ics accept/decline sync with ripple invitation status; we need to deploy in order to test this
    - recurrent events

- I don't really know how to handle unread messages, they kind of work right now but god save me

- remove colors from merge and pull req icons in card and task details

- move relation icon (blocked, ...) to top right corner in task cards

- in gitlab it's impossible to create a branch from a task because the menu let's you chose at the wrong granularity. This connects well with the cardinality 1 project to N repositories. The choice should be presented to chose the repo first and the branch later (this is also valid for github)

- Deferred: dev panel on the task (branch/commits/PR/CI checks inline, à la Linear/Jira)

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
            - [ ] migration: clear `taskCommentIntegrationLinks.externalAuthor` on Ripple-originated comment links written before the avatar-override fix (those still render the bot chip over the real author's avatar). Inbound/external-authored links must keep their `externalAuthor`. Not yet deployed to prod, so safe to defer until first ship.
            - [ ] milestone ↔ cycle sync (opt-in, name-paired via stored `externalMilestoneId`)
            - [ ] priority sync via configurable label template (e.g. `priority/high`)
            - [ ] internal-only task comments (`taskComments.internal` flag; not pushed to GitHub, never set on inbound)
            - [ ] comment/description @mention fidelity on outbound markdown: `userMention`/`eventMention` inline content has no markdown serialization, so `blocksToMarkdownLossy` drops them to empty when pushing to GitHub. To render `@login` we'd need a userId→GitHub-login map at render time (same lossiness affects description sync)
    - [ ] add sentry

- identity model refactor
    - [ ] split `users` (auth-only) from a new `profiles` table that can host synthetic / bot identities (integration bots, system actors); `creatorId`/`assigneeId`/`userId` refs point at `profiles`. Lets integrations create non-auth identities without polluting the auth surface.