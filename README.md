NEXT STEPS:

- add a dependency view to tasks

- consider introducing document snapshots

keyboard accessiblity
    - when pressing tab in a chat, it must focus the message composer
    - esc closes the comments sideba in docs
    - on login, pressing tab from email field should focus pasword field instead of password reset btn
    - keyboard shortcut for focus mode enter and exit
    - pressing tab while unfocused in a spreadsheet page should focus a cell
    - add keyboard shortcut to enter cell formula editor in the spreasheet toolbar

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
    - [ ] kanban active-backlog overflow when a project's uncompleted set grows past the read cap. Decision deferred. Findings so far: a board-wide `limit` on the active query is wrong — it truncates in index order, so one triage/backlog column (fed by inbound integration sync, so not self-limiting) eats the budget and starves "In Progress". The cap has to be per column. Preferred shape: one `tasks.listBoard(projectId, perColumnLimit)` query that fans out `.take(cap+1)` per status over `by_project_status_position` (single subscription; the DnD optimistic update stays a one-query patch), the existing overflow pill on any truncated column, and a `[projectId, statusId]` aggregate so column counts stay honest once windowed. Product alternative to weigh first: cycle-scope the board (Linear's shape) and leave the backlog to the paginated list view — smallest code, shrinks the whole problem.
    - [ ] auto-archive (Linear's structural bound): `archivedAt` on tasks + a workspace setting, excluded from every default read. The only thing that bounds *every* completed axis at once — done column, project lists, cycles, My Tasks — instead of capping each surface. Until then My Tasks caps both axes at the newest 200 and links into the project list view.


- github issues milestone ↔ cycle sync (Linear skips it too; needs a new inbound kind + outbound op in both adapters)
- self-hosted GitLab - `GITLAB_BASE` in `gitlab/oauthClient.ts` (already parameterized on `cfg.base`), plus literals in `gitlab/outboundGateway.ts`, `gitlab/webhook.ts`, `gitlab/forceResyncAction.ts`, `core/syncOutMutations.ts` (issue URL) and web `TaskGithubBranchActions.tsx` (MR URL). A per-integration base URL covers the PAT path; OAuth would also need per-workspace app credentials. Linear does PAT-only.

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


