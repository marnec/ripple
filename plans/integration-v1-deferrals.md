# Plan: integration v1 deferrals (GitHub / GitLab)

> Source: README "External integrations" deferrals, audited 2026-09-03.
> Companion plans: `plans/github-integration.md`, `plans/pr-integration.md`.

Four items ship; two stay deferred. Product decisions were taken to match
Linear's GitHub integration wherever Linear has an answer.

| # | Item | Decision |
|---|------|----------|
| A | Per-user provider identity ("connect your account") | **Build.** Linear model: OAuth-verified, account-level, self-service. |
| B | Private task comments | **Build.** Linear model: private by default, explicit "reply on \<provider\>" lane, immutable. |
| C | Priority ↔ label sync | **Build.** Four explicit label names per link, pattern shortcut in the editor, labels sent at issue creation. |
| D | @mention fidelity on outbound markdown | **Build.** Token-in-markdown, resolved server-side at dispatch. Depends on A. |
| — | Milestone ↔ cycle sync | **Deferred.** Linear doesn't sync it either; cost is a new inbound kind + outbound op in both adapters. |
| — | Self-hosted GitLab | **Deferred.** Audit corrected the README line (see "Corrections" at the end). |

Ship order: **A → D → B → C**. A and D share a release because D's `@login`
rendering is only meaningful once members can connect accounts. B and C are
independent of everything else.

---

## Architectural decisions

### No new tables, all new columns optional

Every schema change below is an `v.optional(...)` column on an existing table,
so there is no migration and no backfill. Convex accepts optional columns on a
running deployment without a staged rollout.

### Identity is account-level, not workspace-level

`workspaceMemberExternalIdentity` (schema.ts ~1557) stays exactly as it is: the
provider-generic **override** layer that the matcher consults first
(`integrations/core/identity.ts`). It still gets no write path in this plan.

The Linear model is "connect your GitHub account once, it applies everywhere".
That is layer 2 of the existing matcher: `users.githubLogin`,
`users.gitlabUserId`, `users.gitlabLogin`, each confirmed against
`workspaceMembers` at lookup time. Today those columns are written only by the
sign-in profile map in `auth.ts`. Plan A adds a second writer: an explicit
OAuth connect flow from user settings. Nothing in `identity.ts` changes.

### Reuse the existing OAuth round trips, branch on purpose

Both providers already have a user-facing OAuth round trip that lands on a
Convex HTTP route and consumes a one-time `integrationInstallStates` nonce:

- GitHub: `beginAppAuthorize` → `https://github.com/login/oauth/authorize` →
  `GET /integrations/github/setup` → `finalizeInstall` (`exchangeUserCode`,
  then `listUserInstallations`).
- GitLab: `beginOAuth` (PKCE) → `/oauth/authorize` →
  `GET /integrations/gitlab/oauth/callback` → `finalizeOAuth`
  (`exchangeCodeForToken`, then `fetchCurrentUser`).

Plan A adds a `purpose` column to the nonce row and a second `begin*` entry
point per provider. The HTTP routes stay single-entry: they consume the nonce,
read `purpose`, and dispatch to either the existing install finalizer or the new
identity finalizer. The identity finalizer discards the provider token after one
`GET /user`; nothing is stored except login and id.

### Outbound markdown is rendered in the browser, resolved on the server

Confirmed by audit: there is no server-side BlockNote serializer. The client
calls `editor.blocksToMarkdownLossy` and posts `bodyMarkdown` / `markdown`
alongside the BlockNote JSON. BlockNote 0.54 (installed) honors an inline
content spec's `toExternalHTML` during markdown export
(`@blocknote/core/src/api/exporters/markdown/markdownExporter.ts` →
`createExternalHTMLExporter` → `serializeInlineContentExternalHTML`, which
prefers `implementation.toExternalHTML`; `@blocknote/react` forwards it at
`ReactInlineContentSpec.tsx:186,319`).

So mentions become **stable tokens** in the client-rendered markdown, and the
dispatch layer in `outboundDispatch.ts`, which already holds `workspaceId` +
`provider` at every push site, rewrites tokens to `@login` or a display name
just before enqueueing. The stored BlockNote JSON is never touched.

### Private comments are a lane chosen at creation, never changed

Ripple task comments are flat, so Linear's "synced thread vs private
discussion" maps to a per-comment boolean chosen in the composer. Flipping later
would require deleting or creating on the provider side; v1 forbids it.

### Priority labels are a per-link map, hidden from the tag system

`projectIntegrationLinks` gains a four-slot map. Priority labels are stripped
before anything reaches `tasks.labels`, `tags`, or `taskTags`, and re-added when
computing the outbound label set. `taskIntegrationLinks.externalLabels` keeps
mirroring the **full** provider set (tags + priority label) so the existing echo
guard keeps working unchanged.

---

## A — Connect your GitHub / GitLab account

### What to build

**Schema**

- `integrationInstallStates.purpose: v.optional(v.union(v.literal("install"), v.literal("identity")))`.
  Absent = `"install"` (rows written before this ship).

**Backend, provider-neutral** (`integrations/core/`)

- `identityConnect.ts` (new):
  - `beginIdentityConnect` (public `mutation`; from `functions.ts`):
    `{ provider: "github" | "gitlab", workspaceId, returnTo }` → `{ url }`.
    Gate: `requireWorkspaceMember` (**member**, not admin). Writes the nonce
    row with `purpose: "identity"`, then builds the provider authorize URL.
    GitHub: same URL as `beginAppAuthorize`. GitLab: needs PKCE, so this half
    is an `action` in `gitlab/identityAction.ts` that calls
    `persistInstallState` (extend it with `purpose`) and
    `buildAuthorizeUrl` with scope `read_user` (add a `scope` option to
    `buildAuthorizeUrl`; default stays `api`).
  - `completeIdentityConnect` (`internalMutation`):
    `{ userId, provider, externalLogin, externalUserId }`.
    Canonicalizes (`trim().toLowerCase()`), then **refuses** when another user
    already holds the login/id (`by_github_login` / `by_gitlab_user_id`
    `.take(2)`): the matcher returns `undefined` on duplicates, so a silent
    overwrite would unmap both users. Writes `users.githubLogin` or
    `users.gitlabUserId` + `users.gitlabLogin`.
  - `disconnectIdentity` (public `mutation`): `{ provider }` → clears the
    columns on the caller's own row. Note in the doc comment that a later
    sign-in through that provider re-captures them (`auth.ts` profile spread).
- `consumeInstallState` returns `purpose` too.

**Backend, GitHub** (`integrations/github/`)

- `oauthClient.ts`: `fetchCurrentUser({ cfg, accessToken })` →
  `{ id: string, login: string }` via `GET /user` (same headers as
  `listUserInstallations`).
- `setupAction.ts`: `finalizeIdentity` (`internalAction`): consume nonce,
  require `purpose === "identity"` and `code`, `exchangeUserCode`,
  `fetchCurrentUser`, `completeIdentityConnect`. Returns
  `{ workspaceId, returnTo } | null`.
- `http.ts` `/integrations/github/setup`: consume-and-branch. Because the
  route currently lets `finalizeInstall` consume the nonce, the cheapest
  change is a tiny `peekInstallStatePurpose` internal query before dispatch
  (read-only, does not delete). Identity success redirects to
  `${siteUrl}${returnTo}?github_identity=success`, failure to
  `/workspaces?github_identity=error`.

**Backend, GitLab** (`integrations/gitlab/`)

- `identityAction.ts` (new): `beginIdentityConnect` (action, member gate via
  a `requireMemberForOAuth` internal query mirroring `assertAdminForOAuth`)
  and `finalizeIdentity` (`internalAction`): consume, exchange with PKCE,
  `fetchCurrentUser`, `completeIdentityConnect` with
  `externalUserId: String(user.id)`, `externalLogin: user.username`.
- `http.ts` `/integrations/gitlab/oauth/callback`: same branch;
  `?gitlab_identity=success|error`.

**Web**

- `UserSettingsDialog.tsx`: new "Connected accounts" section. One row per
  provider: mark + `@login` + Disconnect, or a Connect button. Reads
  `users.viewer` (`githubLogin`, `gitlabLogin` already pass the validator).
  Connect calls `beginIdentityConnect` with `returnTo = location.pathname`
  and navigates to `url`. Rows render only when a `workspaceId` is in the
  route (the nonce row needs one; the dialog already assumes it for "leave
  workspace").
- `lib/integration-callback-notice.ts`: add `github_identity` and
  `gitlab_identity` to `INTEGRATION_CALLBACK_PARAMS` with copy
  "GitHub account connected" / "Couldn't connect your GitHub account".
- `WorkspaceMembersSection.tsx`: when the workspace has an active
  integration for a provider, show a muted "not connected" hint next to
  members lacking that provider's identity. Admin-facing nudge only; no
  admin write path.

### Acceptance criteria

- A member who signed up by email connects GitHub, then assigning them a
  linked task pushes the assignee (`maybeEnqueueAssigneesPush` no longer hits
  the `!ref` skip at `outboundDispatch.ts:414`).
- A GitLab connect stores both id and login; inbound `assignee_ids` resolves
  to the member.
- Connecting a login that another user holds fails with a `ConvexError` and
  leaves both rows untouched.
- Disconnect clears the columns; the next assignee push for that member is
  skipped again.
- A nonce with `purpose: "identity"` cannot complete an install, and vice
  versa. Replayed callbacks fail (nonce is one-time, as today).
- Tests: `tests/integrations.identityConnect.test.ts` (mutations, duplicate
  refusal, purpose isolation), `tests/integrations.github.identity.test.ts`
  and `tests/integrations.gitlab.identity.test.ts` (finalizers with mocked
  fetch, following `integrations.gitlab.oauthClient.test.ts`).

---

## D — @mention fidelity on outbound markdown

### What to build

**Web: emit tokens**

- `Project/CustomInlineContent/UserMention.tsx`: add
  `toExternalHTML: ({ inlineContent }) => <span>@user:{userId}</span>`.
- `Chat/CustomInlineContent/EventMention.tsx`: `toExternalHTML` emitting
  `@event:{eventId}` or `@series:{seriesId}` per `eventMentionTarget`.
- Both specs are shared by chat and task schemas; the token only appears in
  exported markdown, never in the editor, so chat is unaffected.
- Token grammar: `@(user|event|series):[a-z0-9]+`. No markdown-special
  characters, so `htmlToMarkdown` passes it through unescaped. Add a unit test
  that round-trips a mention through `blocksToMarkdownLossy` in
  `apps/web/src/**/*.test.ts` (jsdom).

**Backend: resolve tokens** (`integrations/core/mentionTokens.ts`, new)

- `renderMentionTokens(ctx, markdown, { workspaceId, provider }): Promise<string>`
  - `@user:<id>` → `@<login>` via `memberToExternalLogin` for GitHub and via
    `users.gitlabLogin` (through `ctx.db.get`) for GitLab, since GitLab
    mentions are by username while assignment is by id. Fallback when
    unresolved or not a member: the display name via `getUserDisplayName`
    (no `@`, matching Linear's "not a real mention" behavior). Unknown id →
    `@unknown-user`.
  - `@event:<id>` / `@series:<id>` → the event/series title in plain text.
    Missing → `unknown event`.
  - Unknown token kinds pass through untouched.
- Call sites, each right before `retrier.run`:
  - `maybeEnqueueCommentCreate` (before `appendRippleCommentMarker`),
  - `maybeEnqueueCommentUpdate`,
  - `enqueueDescriptionPush`.
  All three already hold `projectLink.workspaceId` and `integration.provider`
  (via `resolveTaskTarget` / `resolveCommentLinkTarget` / direct lookups).
- Update the doc comments on `taskComments.create/update` (`bodyMarkdown`)
  and `tasks.syncDescriptionToGitHub` that currently promise lossiness.

**Out of scope, recorded**: inbound `@login` → `userMention`. The headless
editor uses the default schema (`lib/headlessEditor.ts:77`), and
`commentSeedAction.ts:18-21` documents why custom inline specs are not
replicated server-side. `externalLoginToMember` makes it cheap later.

### Acceptance criteria

- Pushing a comment "ping @Marco" where Marco has connected GitHub yields
  `ping @marco-login` on the issue; without a connection it yields
  `ping Marco`.
- Event mentions render their title; no token ever reaches a provider (a
  test asserts the regex has no match on the dispatched body).
- Description push behaves identically (`integrations.descriptionPush.test.ts`
  gains a mention case).
- Tests: `tests/integrations.mentionTokens.test.ts` (pure grammar +
  convex-test resolution for both providers).

---

## B — Private task comments

### What to build

**Schema**

- `taskComments.internal: v.optional(v.boolean())`. Absent = public (every
  existing row and every inbound insert at `syncIn.ts:399-404` stays valid).

**Backend**

- `taskComments.create`: new arg `internal: v.optional(v.boolean())`. Persist
  `internal: true` only when the flag is set **and** the task has a
  `taskIntegrationLinks` row; otherwise leave it absent, so comments on
  unlinked tasks don't carry meaningless state. Skip
  `maybeEnqueueCommentCreate` when internal.
- `taskComments.update`: unchanged args; `internal` is immutable.
  Defensive gate: `maybeEnqueueCommentCreate` and `maybeEnqueueCommentUpdate`
  return early on `comment.internal` right after the `ctx.db.get` at
  `outboundDispatch.ts:465` / `:518`. Delete is already safe (no link row).
- `taskComments.list`: add `internal: v.optional(v.boolean())` to the return
  validator and the field pick (`taskComments.ts:20-36`, `:68-79`).

**Web** (`Project/TaskActivityTimeline.tsx`)

- Composer: when the task is linked, a two-option segmented control above the
  editor: **Private note** (default) | **Reply on {providerTitle}**. Hidden
  when unlinked. Ctrl+Enter respects the selection.
- Timeline item: a lock icon + "Private" chip on internal comments, placed
  where the `externalAuthor` chip renders (`:503`). Edit affordance unchanged.

### Acceptance criteria

- On a linked task, the default lane produces a comment with no
  `taskCommentIntegrationLinks` row and no outbound run; the explicit lane
  behaves as today (marker appended, link row written on success).
- Editing a private comment never enqueues an outbound run, even if a link
  row is inserted by hand in a test.
- On an unlinked task, comments store no `internal` field and the control
  is not rendered.
- Inbound comments are never internal.
- Tests: extend `tests/integrations.syncOut.comments.test.ts` and
  `tests/integrations.taskComments.list.test.ts`.

---

## C — Priority ↔ label sync

### What to build

**Schema**

- `projectIntegrationLinks.priorityLabels: v.optional(v.object({ urgent: v.optional(v.string()), high: v.optional(v.string()), medium: v.optional(v.string()), low: v.optional(v.string()) }))`.
  Values stored normalized like tags (`trim().toLowerCase()`). Absent = no
  priority sync for that link.
- `NormalizedIssueEvent` `issue.opened` and `issue.reopened` gain
  `labels?: string[]` (`integrations/core/types.ts:118`). GitHub's
  `issues.opened` payload carries `issue.labels`; the webhook adapter already
  maps them for `labels_changed` (`github/webhook.ts:266`). Import
  (`importDrain.ts`) maps the REST `labels` the same way.

**Backend, config** (`integrations/core/links.ts`)

- `setPriorityLabels({ linkId, priorityLabels })`, admin-gated like
  `setInboundIssueSync`. Validates: non-empty after normalization, four
  distinct values, none equal to a tag currently in `autoSelectTags` of the
  same project (a tag can't be both a router key and a priority label).
  Passing all-empty clears the column.

**Backend, shared helper** (`integrations/core/priorityLabels.ts`, new)

- `splitPriorityLabels(labels, map) → { tags: string[], priority?: Priority }`.
  Highest wins when several match (`urgent > high > medium > low`).
- `withPriorityLabel(tags, priority, map) → string[]` (tags ∪ mapped label,
  normalized, deduped).

**Backend, inbound** (`integrations/core/syncIn.ts`)

- `applyLabelsChanged`: keep the existing echo guard on the full set. Then
  `split`; write `tags` to `syncTaskTags` / `tasks.labels`; if `priority` is
  defined and differs, patch `tasks.priority` and log a `priority_change`
  activity attributed to the bot user. If no priority label is present,
  **leave priority unchanged**. `externalLabels` keeps the full set.
- `createTaskFromEvent`: when the event carries labels, apply the same split
  at insert time (`priority` replaces the `"medium"` literal at `:492`,
  falling back to `"medium"`), reconcile tags via `syncTaskTags`, and seed
  `externalLabels` on the new `taskIntegrationLinks` row so the follow-up
  `labeled` webhooks GitHub emits after an opened-with-labels issue hit the
  echo guard.

**Backend, outbound** (`integrations/core/outboundDispatch.ts`)

- `maybeEnqueueLabelsPush`: `nextLabels = withPriorityLabel(task.labels, task.priority, projectLink.priorityLabels)`.
  Diff against `externalLabels` as today. The labels sink already writes
  `externalLabels: result.nextLabels` (`syncOutMutations.ts:72`).
- `tasks.update`: fourth dispatch gate next to the three at
  `tasks.ts:1113-1126`: `if (priority !== undefined && priority !== task.priority) await maybeEnqueueLabelsPush(ctx, taskId)`.
- `enqueueIssueCreate`: compute the same set and pass `labels` through
  `adapter.ops.createIssue`. Port: `createIssue({ projectRef, title, body, labels? })`.
  GitHub gateway sends `labels: string[]`; GitLab gateway sends
  `labels: labels.join(",")`. Both providers auto-create missing labels on
  the issue endpoint for a token with write access. `issueCreateSink` records
  `externalLabels` from the sent set so the bounce-back `labeled` events are
  suppressed. Both `pushCreateIssue` actions gain
  `labels: v.optional(v.array(v.string()))`.

**Web**

- `Workspace/PriorityLabelsEditor.tsx` (new), mounted in
  `Project/IntegrationCardShell.tsx` after `BranchSourceDefaultsEditor`.
  Four inputs (Urgent, High, Medium, Low) and a "Fill from pattern" input
  that expands `{priority}` (e.g. `priority/{priority}` → `priority/urgent`
  …) into the four fields without saving. Save calls `setPriorityLabels`.
  Clear button empties all four.

### Acceptance criteria

- Inbound: an issue labeled `P1` on a link mapping high→`p1` becomes a
  high-priority task whose `labels` and `taskTags` do **not** contain `p1`.
  Removing the label upstream leaves the priority unchanged.
- Outbound: changing priority urgent→low on a linked task enqueues one labels
  push with `add: ["p3"], remove: ["p0"]`; a tag edit still pushes tags and
  keeps the priority label in place.
- Creating an issue from a task sends its tags and priority label in the
  create call, and the immediate `labeled` webhooks are dropped by the echo
  guard (no duplicate `taskTags` reconciliation, no activity noise).
- A link without `priorityLabels` behaves exactly as today (tests in
  `integrations.syncOut.test.ts` and `integrations.syncIn.test.ts` unchanged).
- Tests: `tests/integrations.priorityLabels.test.ts` (helper + inbound +
  outbound + create-with-labels), extend `integrations.links.test.ts` for the
  validation rules.

---

## Corrections to the README deferral lines

- **Mention fidelity**: the failure is not that "`blocksToMarkdownLossy` runs
  server-side without a login map". Rendering is client-side, and the
  installed BlockNote already supports `toExternalHTML` on inline content.
  The fix is tokens plus a server-side rewrite at dispatch (Plan D).
- **Self-hosted GitLab** (still deferred): `tokenClient.ts` has no literal;
  it inherits the host from `oauthClient.GITLAB_BASE`. Three sites were
  missing from the list: `core/syncOutMutations.ts:65` (persisted issue URL),
  `web …/Project/TaskGithubBranchActions.tsx:181` (new-MR URL), and
  `gitlab/webhook.ts:89` (author profile fallback). `oauthClient` is already
  parameterized on `cfg.base` and tested with a non-gitlab.com base. A base
  URL alone covers the PAT path; the OAuth path also needs per-workspace
  OAuth app credentials. Linear supports self-hosted via PAT only.
- **`workspaceMemberExternalIdentity` write path**: resolved by Plan A at the
  account level; the table keeps its override role and still has no UI.
