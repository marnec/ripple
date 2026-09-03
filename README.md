NEXT STEPS:

- add a dependency view to tasks

- consider introducing document snapshots

keyboard accessiblity
    - when pressing tab in a chat, it must focus the message composer
    - esc closes the comments sideba in docs
    - on login, pressing tab from email field should focus pasword field instead of password reset btn
    - keyboard shortcut for focus mode

- internationalization (i18n and localization)

- add timezone setting to workspace, this should be inherited by all time-related values in the app. Find efficient way for this, evaluate join vs denormalization. Consider that most likely update is seldom.

- [ ] AI integrations
    - [ ] AI bot in chat (called on mention)
    - [ ] AI dictate content
    - [ ] AI agent in videocall (unclear how to handle diarization)
    - [ ] AI document agent
    - [ ] AI tasks agent

- avatars:
    - [ ] user custom avatars: look at dicebear
    - [ ] facepile not using user avatar (investigate convex cost)

- tag system follow-ups
    - [ ] cycle-scoped tag filter — `taskTags` already has room for a `[cycleId, tagId]` index when needed

- task query scaling
    - [ ] `listByAssignee` is workspace-scoped now, but still an unpaginated `.collect()` of every task assigned to the caller in that workspace (both the tag and no-tag branches) — needs a cap or pagination for heavy users
    - [ ] kanban active-backlog overflow strategy when a project's uncompleted set grows past the read cap
    - [ ] `AddTasksToCycleDialog` "show completed too" toggle if users request it

- [ ] External integrations
    - [ ] github issues
        - v1 deferrals (revisit after first ship):
            - [ ] milestone ↔ cycle sync (opt-in, name-paired via stored `externalMilestoneId`)
            - [ ] priority sync via configurable label template (e.g. `priority/high`)
            - [ ] internal-only task comments (`taskComments.internal` flag; not pushed to GitHub, never set on inbound)
            - [ ] comment/description @mention fidelity on outbound markdown: `userMention`/`eventMention` inline content has no markdown serialization, so `blocksToMarkdownLossy` drops them to empty when pushing to GitHub. To render `@login` we'd need a userId→GitHub-login map at render time (same lossiness affects description sync)
    - [ ] gitlab (end-to-end built: OAuth + project picker + webhooks + outbound gateway; remaining gaps)
        - [ ] self-hosted GitLab — `gitlab.com` is hardcoded across `integrations/gitlab/*` (tokenClient, oauthClient, outboundGateway, branchesAction, forceResyncAction); needs a per-integration base URL
    - [ ] `workspaceMemberExternalIdentity` has no write path — no mutation, no UI. Identity resolution falls back to OAuth-captured columns only, so a member who signed in with a different account can never be an assignee-push target. Needs a per-workspace "you are @x on <provider>" mapping screen

- I don't really know how to handle unread messages, they kind of work right now but god save me

- identity model refactor
    - [ ] split `users` (auth-only) from a new `profiles` table that can host synthetic / bot identities (integration bots, system actors); `creatorId`/`assigneeId`/`userId` refs point at `profiles`. Lets integrations create non-auth identities without polluting the auth surface.

- explore pdf reading, annotation and embedding

- evaluate cross-workspace aggregates to re-introduce admin overview

- link previews in chat

- external ticketing system??: 
    - connected to project
    - connected somehow to tasks
    - external ticketer can be given access to specific resources in workspaces through links (attach to ticket??)


