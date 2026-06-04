NEXT STEPS:

- calendar;
    - ics accept/decline sync with ripple invitation status; we need to deploy in order to test this
    - recurrent events

- fix sidebar overflows and scrolls horizontally 

- move references btn in doc header from its current pos to right btn array, leave only icon, disabled if no refs
- embedded table width should behave exactly like embedded diagram width it should acquire a width and keep it until possible, it should only shrink if its container shrinks to much (e.g. full width table and comments sidebar opens)

- add a dependency view to tasks

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
            - [ ] migration: clear `taskCommentIntegrationLinks.externalAuthor` on Ripple-originated comment links written before the avatar-override fix (those still render the bot chip over the real author's avatar). Inbound/external-authored links must keep their `externalAuthor`. Not yet deployed to prod, so safe to defer until first ship.
            - [ ] milestone ↔ cycle sync (opt-in, name-paired via stored `externalMilestoneId`)
            - [ ] priority sync via configurable label template (e.g. `priority/high`)
            - [ ] internal-only task comments (`taskComments.internal` flag; not pushed to GitHub, never set on inbound)
            - [ ] comment/description @mention fidelity on outbound markdown: `userMention`/`eventMention` inline content has no markdown serialization, so `blocksToMarkdownLossy` drops them to empty when pushing to GitHub. To render `@login` we'd need a userId→GitHub-login map at render time (same lossiness affects description sync)
    - [ ] add sentry

- I don't really know how to handle unread messages, they kind of work right now but god save me

- identity model refactor
    - [ ] split `users` (auth-only) from a new `profiles` table that can host synthetic / bot identities (integration bots, system actors); `creatorId`/`assigneeId`/`userId` refs point at `profiles`. Lets integrations create non-auth identities without polluting the auth surface.