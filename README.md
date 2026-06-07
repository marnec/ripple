NEXT STEPS:

- unifiorm all settings sections to the workspace and project layout
- split the project layout integration settings section in integration and status automation
- add an invitation management section to the workspace settings where you can revoke or resend inviations
- add a (workpook) background job backoffice center (of the workspace, admin only)
- build a cross-workspace admin app, only accessible to my own account, with jobs, activity log and other useful info


- calendar;
    - ics accept/decline sync with ripple invitation status; we need to deploy in order to test this
    - recurrent events

- add a dependency view to tasks
- add gantt with frappegantt


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

- deferred refactors
    - [ ] don't denormalize author name/image onto `messages` (profile edit → rewrites every message); if chat read-cache coupling ever bites, fix read-side (one-row-per-user digest joined at query time)
    - [ ] sidebar digest table for `workspaceSidebarData.get` (currently 4-table `.collect()` feeding the always-mounted sidebar — largest standing cache-invalidation surface)
    - [ ] extract `IntegrationCardShell` + shared stepper from `ConnectGithubWizard`/`ConnectGitlabCard` twins (keep provider wizards as explicit variants)


- [ ] External integrations
    - [ ] github issues
        - v1 deferrals (revisit after first ship):
            - [ ] milestone ↔ cycle sync (opt-in, name-paired via stored `externalMilestoneId`)
            - [ ] priority sync via configurable label template (e.g. `priority/high`)
            - [ ] internal-only task comments (`taskComments.internal` flag; not pushed to GitHub, never set on inbound)
            - [ ] comment/description @mention fidelity on outbound markdown: `userMention`/`eventMention` inline content has no markdown serialization, so `blocksToMarkdownLossy` drops them to empty when pushing to GitHub. To render `@login` we'd need a userId→GitHub-login map at render time (same lossiness affects description sync)
    - [ ] add sentry

- I don't really know how to handle unread messages, they kind of work right now but god save me

- identity model refactor
    - [ ] split `users` (auth-only) from a new `profiles` table that can host synthetic / bot identities (integration bots, system actors); `creatorId`/`assigneeId`/`userId` refs point at `profiles`. Lets integrations create non-auth identities without polluting the auth surface.