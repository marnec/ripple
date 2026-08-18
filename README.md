NEXT STEPS:

- local-first follow-ups (the reconciliation pass is done — see `isHydrated` in
  `use-collaborative-doc.ts`, `collab/empty-document.ts`, and the case matrix in
  `lib/collab/empty-document.test.ts`)
    - [ ] Convex metadata is still unavailable offline: pages render from the
      Yjs copy with a degraded header (name from `localResourceName`), but
      tags, favourites, backlinks and settings need a round-trip. A local
      cache for `documents.get`/`diagrams.get`/`spreadsheets.get` would close it
    - [ ] the sidebar and every list page still need Convex, so offline the
      only reachable resources are ones already open or reachable by URL
    - [ ] `EMPTY_DOCUMENT_UPDATE` only protects documents bootstrapped after it
      shipped. Documents whose root was authored by a client before it keep the
      old rival-root exposure if one is ever written to unhydrated — the
      `isHydrated` gate is what actually prevents that, the seed is the second
      line. A backfill would have to rewrite each document's root, so there
      isn't one

- cascade delete collection phase is bounded even for batched deletes and will hit a ceiling for extremely large cascaded entities.

- recurrent events in calendar

- add a dependency view to tasks

- explore pdf reading, annotation and embedding

- [ ] link previews in chat

keyboard accessiblity
    - when pressing tab in a chat, it must focus the message composer

- [ ] internationalization (i18n and localization)

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

- deferred refactors
    - [ ] `workspaceSidebarData.get` is channels-only now (the projects/documents/diagrams/spreadsheets `.collect()` moved to `nodes.suggest` / `breadcrumb.getResourceNames`). Residual cost on the always-mounted query: `channels` + `channelMembers` + `userChannelState` still join the invalidation set of every connected member, plus a per-hidden-DM latest-message read and a per-unnamed-DM `channelMembers.collect()` for the display name. Denormalize the DM name before considering a digest table.
    - [ ] extract `IntegrationCardShell` + shared stepper from `ConnectGithubWizard`/`ConnectGitlabCard` twins (keep provider wizards as explicit variants)


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
    - [ ] add sentry

- I don't really know how to handle unread messages, they kind of work right now but god save me

- identity model refactor
    - [ ] split `users` (auth-only) from a new `profiles` table that can host synthetic / bot identities (integration bots, system actors); `creatorId`/`assigneeId`/`userId` refs point at `profiles`. Lets integrations create non-auth identities without polluting the auth surface.

- evaluate cross-workspace aggregates to re-introduce admin overview

- external ticketing system??: 
    - connected to project
    - connected somehow to tasks
    - external ticketer can be given access to specific resources in workspaces through links (attach to ticket??)