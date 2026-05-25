NEXT STEPS:
- calendar; plan calls; invite guests
    - ics accept/decline sync with ripple invitation status; we need to deploy in order to test this
    - recurrent events

- unread channels: DECIDED — boolean "something new" badge (dot + bold name), no numeric count.
    - Rationale: exact per-channel counts conflict with the "only essential information" UX
      principle (a number is noise; "there's something new" is the signal — cf. Discord/Slack,
      which show numbers only for DMs/mentions). A count also costs either a per-message scan or
      a maintained aggregate (extra writes + per-channel root contention on `messages`, our
      highest-write-rate table). A boolean needs neither.
    - Impl: `channelReads.getUnreadStatus` — one `.first()` on the `undeleted_by_channel` index
      per channel, compared against a baseline. Baseline = `userChannelState.lastReadAt`, else
      (never visited) the user's join time: workspace-join (`workspaceMembers._creationTime`) for
      OPEN channels, channel-join (`channelMembers._creationTime`) for closed/dm. Zero extra write
      cost per message; correct under soft-deletes (reads live rows).
    - GOTCHA: open channels have NO `channelMembers` rows (access is via workspace membership), so
      `markRead` must branch on channel type to write a read marker for them — otherwise open
      channels (the common kind) never get a `lastReadAt` and can never badge. This was the
      original reason the badge appeared to do nothing.
    - Rejected: https://github.com/TimpiaAI/convex-unread-tracking (per-message registration we
      don't need) and `@convex-dev/aggregate` for counts (only worth it if exact counts ever
      become a hard requirement — revisit then, scoped to DMs/mentions where volume is low).

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