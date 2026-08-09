NEXT STEPS:

- add a (workpook) background job backoffice center (of the workspace, admin only)

---
- build a cross-workspace admin app, only accessible to my own account, with jobs, activity log and other useful info
---

- recurrent events in calendar

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
    - [x] facepile presence model — presence is now membership of the awareness map (tab open on the doc = your face is there, typing or not), not "sent an update in the last 10s"; that filter was standing in for cleanup that didn't exist. Availability is a separate, *self-reported* signal (`awareness-activity.ts` publishes `{idle}` from tab visibility + input recency; hidden tab → idle at once, otherwise 2 min without input) rendered as the greyed avatar `ActiveUsers` already had. Peers never infer it — only your own browser can tell reading from gone. Applies to docs, tasks, spreadsheets and diagrams
    - [x] ghost cursors after a tab closes — y-partyserver's provider announces departure from a `window unload` listener (which modern browsers don't fire on tab close) *and* calls `clearInterval(awareness._checkInterval)`, killing both halves of y-protocols' liveness contract; the server then replays its awareness map to every joiner, so a stale cursor came back on each reload. Fixed on both ends: the server tracks which awareness clients belong to which connection (`AwarenessOwnership`) and retires them on close/error/connect/permission-tick, and the client runs its own refresh+sweep loop (`awareness-heartbeat.ts`, 8s refresh / 30s sweep). The facepile's 10s stale filter in `use-cursor-awareness` is now a display fallback rather than the only cleanup — with the heartbeat restored, present-but-idle users stop flickering out of it
    - [x] per-connection presence entries, derived per-user (`PresenceRegistry`) — a user's tabs no longer overwrite each other's location, and closing the representing tab falls back to a surviving one instead of stranding the user on a page they left. Supersedes the old "share the presence connection across tabs (BroadcastChannel/SharedWorker)" item: presence is one DO per workspace, so extra tabs cost connections, not rooms — the leader-election machinery wasn't buying the correctness it looked like it was
    - [x] deduplicate token requests per resource (`collaboration-token-cache.ts`) — the waste was *within* a tab, not across them: `getCollaborationToken` is an action fired on every provider construction (every task-sheet open, every doc navigation, every reconnect). Now cached per room behind a shared `fetchCollaborationToken(key, fetcher)` used by `use-yjs-provider` / `use-guest-yjs-provider` / `use-workspace-presence`, with concurrent callers coalesced onto one request. Freshness comes from the token's own `exp` claim (not a TTL constant duplicated from the server) minus a 60s margin; rejected connections `invalidateCollaborationToken` so a retry is a real access check, and `clearCollaborationTokenCache` on session end keeps a token from outliving its user. Cross-tab sharing via BroadcastChannel could layer on top for little extra gain

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