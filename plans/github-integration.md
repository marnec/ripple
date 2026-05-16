# Plan: GitHub integration (project ↔ repo sync)

> Source PRD: [marnec/ripple#2](https://github.com/marnec/ripple/issues/2)

## Architectural decisions

Durable decisions that apply across all phases.

### Routes & entry points

- **Webhook**: `POST /integrations/github/webhook` (Convex `httpAction`). Provider-specific entry point; future GitLab adapter ships its own.
- **Activation entry**: project-settings page, "Connect GitHub repo" button (capability-gated; muted card with admin hint when capability off).
- **Admin surface**: workspace-settings "Integrations" tab (read-mostly) lists installations + links + per-link last-webhook timestamp + unlink/uninstall.

### Code organization

- `apps/convex/convex/integrations/core/` — provider-agnostic logic: `syncIn`, `syncOut`, `description`, `entitlements`, `importJob`. Operates on a `NormalizedIssueEvent` shape.
- `apps/convex/convex/integrations/github/` — provider-specific: `webhook` (signature verify + payload → normalized event), `client` (REST wrappers), `app` (JWT signing + installation-token minting).
- Future `apps/convex/convex/integrations/gitlab/` follows the same shape. **Architectural contract**: adding GitLab must require zero changes to `core/`.
- Frontend lives under `apps/web/src/`: activation wizard, workspace-settings integrations tab, project-settings connect card, task badge + description sync indicator.

### Schema (provider-agnostic field names)

- **`workspaceIntegrations`** — per-workspace install row. One synthetic bot user (`users.isBot=true`) per row, used for external authorship attribution.
- **`workspaceEntitlements`** — keyed on `(workspaceId, featureKey)`; columns `enabled`, `source` (`"manual" | "tier" | "plugin"`), audit fields. `hasFeature(ctx, workspaceId, featureKey): Promise<boolean>` is the single chokepoint.
- **`projectIntegrationLinks`** — repo↔project binding. Status state machine `configuring → active → paused → disconnected`. Orthogonal `pausedByBilling: boolean`. Effective status = `(status === 'active' && !pausedByBilling)`.
- **`taskIntegrationLinks`** — per-task hot/dynamic state: `externalIssueId`, `externalState`, `externalStateReason`, `externalUpdatedAt`, `externalAuthor`, `externalAssignees`, `descriptionSyncState`, `lastSyncedMarkdownHash`, `lastSyncError`. Read only by task detail + webhook handlers; **never** joined by kanban/task-list reads.
- **`taskCommentIntegrationLinks`**, **`taskPullRequestLinks`** — per-comment / per-PR link rows.
- **`processedWebhookDeliveries`** — dedup row keyed on `X-GitHub-Delivery` UUID; written only after successful processing.
- **`tasks.externalRefs[]`** — static immutable-per-link reference array (`provider`, `repoFullName`, `issueNumber`, `url`). Written exactly twice (link create + link destroy) plus on rename. Kanban-safe.
- **`tasks.externalRefFrozen`** — denormalized snapshot written before disconnect, preserves historical context.
- **`taskStatuses.isTriage: boolean`** — mutually exclusive with `isDefault`. Mutation guard rejects user writes to `isTriage` statuses; only internal sync-in path can write triage.
- **`taskStatuses.externalCloseReason: "completed" | "not_planned" | null`** — drives GitHub `state_reason` on close.

### Key models

- **`NormalizedIssueEvent`** — the provider-neutral event shape that `core/syncIn.applyNormalizedEvent` consumes. The integration's core business logic operates on this shape exclusively.
- **`effectiveLinkStatus(link)`** — derived from `(status, pausedByBilling)`. Eight-cell matrix tested as a unit.
- **Provider-specific optional fields** (e.g., `externalCloseReason`, `externalAccountType: "organization" | "group" | "user"`) are schema-level optionals, documented as provider-specific, ignored by other providers.

### Auth & credentials

- GitHub App (unlisted public) is the **only** credential model in v1. No PAT, no OAuth-with-elevated-scopes, no reuse of Convex Auth tokens.
- Installation is workspace-level; a workspace can install on multiple GitHub accounts (org + personal + …).
- App id, private key, webhook secret live in Convex env vars. Installation tokens minted on-demand via JWT. No long-lived OAuth tokens stored.
- Only workspace admins can install, link, unlink, configure, or pause.

### Sync mechanics

- **Outbound**: mutation enqueues the push via `@convex-dev/action-retrier` (configured with `initialBackoffMs ≈ 2000`, `base: 2`, `maxFailures: 4`); PATCH lands within ~1 s on a healthy first attempt. No client debounce. The retrier owns the retry-loop / scheduling / exponential-backoff substrate. The action body classifies each response: 2xx → records success and returns cleanly; 4xx non-429 → records `lastSyncError` and returns cleanly (no further retries); 5xx and network errors → throws (retrier backs off); 429 → pre-sleeps `Retry-After` then throws. "⚠ Sync failed — Retry" surfaces on the task after final failure via the retrier's `onComplete` callback. **Deviation from the PRD**: PRD describes a hand-rolled retry loop; we adopt action-retrier instead, keeping only the classification/echo/freeze/desired-state logic in `core/syncOut`.
- **Inbound**: `@convex-dev/webhook-receiver` exposes the HTTPS endpoint, performs HMAC-SHA256 signature verification, deduplicates by `X-GitHub-Delivery`, and invokes our handler mutation per delivery. The component manages its own dedup/retry/DLQ tables — we don't run a `processedWebhookDeliveries` table of our own. The handler's job is the business logic: normalize the payload → resolve workspace/link → freeze gate → dispatch to `core/syncIn.applyNormalizedEvent`. **Deviation from the PRD**: PRD describes a hand-rolled webhook endpoint with a custom `processedWebhookDeliveries` table and freeze-specific dedup-row suppression to let GitHub's retries land when entitlement restores. With the component's opaque dedup, that retry-on-restore property is lost — recovery from entitlement-revoked drops shifts to the manual "Force resync" button (Phase 9). Acceptable: Force resync exists exactly for this drift-recovery case.
- **Echo prevention**: `externalUpdatedAt` mirror per linked entity; inbound drops stale events; outbound skips when desired state already matches `externalState`.
- **Webhook freeze behavior**: paused links drop webhooks and write the dedup row; entitlement-frozen links drop webhooks **without** writing the dedup row (so GitHub retries land if entitlement restores within the retry window).
- **No centralized rate-limit row** — would create OCC contention on `workspaceIntegrations`. React to 429s only.
- **Subscribed events**: `issues` (opened, edited, closed, reopened, assigned, unassigned, labeled, unlabeled, deleted), `issue_comment` (created, edited, deleted), `pull_request` (opened, edited, closed, reopened), `installation`, `installation_repositories`.

### Bot user attribution

- Each `workspaceIntegrations` row gets one synthetic `users` row with `isBot=true`. External-author tasks and comments are attributed to this bot user; per-link `externalAuthor: { login, avatarUrl, url }` carries the GitHub identity for display.
- Bot users are filtered out of member pickers, mentions, and facepiles.
- The `users` → `profiles` table split is deferred to a separate refactor; v1 reuses `users` with the `isBot` flag.

### Audit log

- Reuses existing audit log table with new event types: `integration.activated`, `integration.paused`, `integration.entitlement.granted`, `integration.entitlement.revoked`, `integration.repo_linked`, `integration.repo_unlinked`, `integration.import_started`, `integration.import_completed`, `integration.import_failed`, `integration.sync_failed`.
- Webhook-driven per-event ingestion is **not** logged — admin actions only.

### Cardinality

- A repository can be linked to at most one Ripple project (globally unique `externalRepoId` constraint, enforced at the mutation layer with a pointer-to-existing-project error).
- A project can have one or more linked repositories.
- Repo rename events update `externalRepoFullName` silently; stable `externalRepoId` keeps the link intact.

---

## Phase 1 — Tracer: install + link + import + inbound webhook → triage

**User stories**: 1–7 (workspace admin setup), 8–14 (repo↔project binding), 15–20 (activation gate + import), 21–25 (triage semantics), 49 (external author display, inbound side), 52–54 (dedup + last-webhook indicator), 57 (audit log for admin actions), 58, 62 (manual entitlement toggle), 67 (provider abstraction shape).

### What to build

A workspace admin installs the Ripple GitHub App on an org, links a repo to a project, runs the import wizard (preview → confirm), and watches external GitHub issues land in a dedicated triage status as new Ripple tasks — both at import time and live via webhooks. The entitlement gate, the synthetic bot user, the audit-log events, and the workspace-settings integrations tab all ship in this phase. **Outbound sync does not exist yet; the integration is inbound-only.**

This phase is the architectural tracer: it proves the full stack end-to-end (entitlement → install → link → import drain → webhook ingest → triage write) on real data before any field-by-field sync rules ship.

### Acceptance criteria

- [ ] Admin can toggle GitHub-integration capability in workspace settings; non-admins see "ask an admin" copy
- [ ] Admin can install the GitHub App via the wizard and authorize one or more accounts (org or personal)
- [ ] Workspace-settings Integrations tab lists installations, links, installer, and last-webhook timestamp per link
- [ ] Project-settings "Connect GitHub repo" wizard binds a repo to a project; rejects repos already linked elsewhere with a pointer to the existing project
- [ ] Renaming a repo on GitHub keeps the link intact (stable `externalRepoId`); `externalRepoFullName` updates silently
- [ ] Activation refuses to proceed unless the project has an `isTriage=true` status; default project status seed includes a Triage status
- [ ] Import filters (open-only default, optional include-closed, optional label list) and preview count work
- [ ] Initial import drains via workpool with live progress on `taskImportJobs`; `projects.taskCounter` is pre-allocated at job start; import is idempotent on `externalIssueId`
- [ ] Externally-opened issues arrive via webhook and create tasks in triage; redelivered webhooks are no-ops; webhooks for frozen workspaces are dropped without writing the dedup row
- [ ] No user can manually move a task into triage; triage doesn't appear in status pickers, kanban drop targets, or new-task forms
- [ ] Triage status is configurable per project (color, name, position); exactly one `isTriage=true` per project enforced
- [ ] External author (login, avatar, profile URL) renders on imported tasks via the bot user + `externalAuthor` blob
- [ ] Audit log records: `integration.activated`, `integration.repo_linked`, `integration.repo_unlinked`, `integration.entitlement.granted/revoked`, `integration.import_started/completed/failed`
- [ ] Tests: `core/syncIn` idempotency / ordering (stale-event drop) / freeze drop / triage routing / triage-write authorization (only internal callers); `core/importJob` counter pre-allocation / idempotency / open-only & label filters / progress reporting / triage destination; `core/entitlements` `hasFeature` + 8-cell `effectiveLinkStatus` matrix + entitlement fanout to all workspace links; `github/webhook` signature verification (valid/invalid/missing) + headline event parsing on pinned `tests/fixtures/github/` payloads

---

## Phase 2 — Bidirectional status sync

**User stories**: 26–31.

### What to build

Closing or reopening a task in Ripple flips the GitHub issue, and vice versa. Admins can mark certain completed statuses as `not_planned` so closing a task in those statuses closes the GitHub issue with the "not planned" state reason (visually distinct on GitHub). Externally-reopened issues return to triage. Echo prevention works in both directions. The first outbound code path (`core/syncOut`) ships here.

### Acceptance criteria

- [ ] Closing a Ripple task → GitHub issue closes within ~1 s; reopen mirrors
- [ ] Closing a GitHub issue with `state_reason=completed` → routes to first `isCompleted` status by `order`
- [ ] Closing with `state_reason=not_planned` → routes to first `isCompleted && externalCloseReason="not_planned"`; falls back to default completed if none configured
- [ ] Externally-reopened issue → Ripple task returns to triage (consistent with the ingestion-only triage rule)
- [ ] Admin can configure `externalCloseReason` per status in status-settings UI
- [ ] Echo guard skips outbound when Ripple state already matches `externalState`
- [ ] Echo guard drops inbound events with stale `externalUpdatedAt`
- [ ] Hard-fail sync errors write `lastSyncError` and surface a "⚠ Sync failed — Retry" affordance on the affected task
- [ ] `integration.sync_failed` audit log entry written on permanent failures
- [ ] Tests: `core/syncIn` status routing for every `state × state_reason` case + reopen→triage; `core/syncOut` 5xx exponential backoff (up to 4 retries) / 429 honors `Retry-After` / 4xx writes `lastSyncError` and stops / freeze rejects dispatch / echo skip when state matches

---

## Phase 3 — Labels bidirectional

**User stories**: 33, 34.

### What to build

Labels sync bidirectionally with name-based matching. Adding or removing a label on either side updates the other. Labels created on either side auto-create on the other (no manual mapping table). Renames sever the link (documented behavior).

### Acceptance criteria

- [ ] Adding/removing a Ripple label updates GitHub; vice versa
- [ ] Labels created on either side auto-create on the other (name-based)
- [ ] Renaming a label on either side severs the link (subsequent edits on each side stay local) — behavior documented
- [ ] Echo prevention applies to label changes
- [ ] Tests: `core/syncIn` label name-matching + auto-create on inbound; `core/syncOut` label add/remove dispatch; rename-as-disconnect behavior

---

## Phase 4 — Assignees bidirectional + `closed_by` display

**User stories**: 35, 36, 51.

### What to build

A Ripple `assigneeId` pushes 1→1 to GitHub as the single assignee. GitHub issues with multiple assignees on inbound: the first GitHub login that matches a workspace member becomes `assigneeId`, remaining assignees land in `taskIntegrationLinks.externalAssignees` and render as shadow chips on the task detail. When no GitHub assignee matches a workspace member, `assigneeId` falls back to the bot user; shadow chips still display the real GitHub identities so no information is lost. "Closed on GitHub by @octocat" appears on tasks closed externally.

### Acceptance criteria

- [ ] Ripple `assigneeId` change → GitHub single assignee updates
- [ ] GitHub multi-assignee inbound → first matched workspace member becomes `assigneeId`; remainder render as shadow chips on task detail
- [ ] No matching GitHub assignee → `assigneeId` falls back to bot user; chips still display real GitHub identities
- [ ] Task detail shows "Closed on GitHub by @\<login\>" when `closed_by` was an external GitHub user
- [ ] Tests: `core/syncIn` assignee matching (workspace member match → first wins, no-match → bot-user fallback) with `externalAssignees` populated correctly; `core/syncOut` 1→1 assignee dispatch

---

## Phase 5 — Comments bidirectional ✅

**User stories**: 37–39, 50.

### What to build

Comments sync both ways with plain-text bodies. Edits and deletes propagate. External-author comments are attributed to the bot user with the contributor's GitHub identity (login + avatar) shown alongside.

### Acceptance criteria

- [ ] Ripple comment create/edit/delete → GitHub comment create/edit/delete
- [ ] GitHub comment create/edit/delete → Ripple comment with bot-user authorship + per-comment `externalAuthor`
- [ ] Echo prevention on comments via per-comment-link `externalUpdatedAt` mirror
- [ ] `taskCommentIntegrationLinks` rows track GitHub comment id + last-known state
- [ ] Tests: `core/syncIn` comment create / update / delete idempotency + echo prevention; `core/syncOut` dispatch for each verb; external attribution renders bot-user with `externalAuthor`

---

## Phase 6 — Description creation-seed + manual sync + desync detection

**User stories**: 40–45.

### What to build

GitHub→Ripple seeds the BlockNote description from the issue body at **creation time only** (markdown → BlockNote → Yjs seed). Ripple→GitHub is **push-only** via a manual "Sync description to GitHub" button. The button only appears when description state is `desynced` or `never-synced` AND the description is non-empty. A synced / desynced / never-synced badge sits near the description; it flips optimistically on first keystroke after a synced state and reconciles to truth when the snapshot saves server-side (markdown hash compare against `lastSyncedMarkdownHash`). GitHub-side description edits after creation are ignored — live Ripple collaboration is never disrupted by external edits.

### Acceptance criteria

- [ ] Issue created on GitHub → Ripple task description seeded from issue body (markdown → BlockNote / Yjs)
- [ ] Ripple-native task → empty GitHub issue body at creation; no automatic content push
- [ ] Description sync badge shows synced / desynced / never-synced state accurately
- [ ] "Sync description to GitHub" button is hidden when description is empty or already synced; visible when desynced or never-synced AND non-empty; pushes markdown on click
- [ ] Editing BlockNote flips badge to `desynced` optimistically; server reconciles on snapshot save by hashing rendered markdown and comparing to `lastSyncedMarkdownHash`
- [ ] GitHub-side description edits after creation do NOT overwrite the Ripple description
- [ ] PartyKit's existing Yjs snapshot-push HTTP endpoint is extended to compute markdown hash + update `descriptionSyncState`
- [ ] Tests: `core/description` markdown-hash stability (same content → same hash); hash differs for material content changes (insertion / deletion / formatting); state machine transitions (`never-synced` → `synced` on first push, `synced` → `desynced` on hash divergence, `desynced` → `synced` on push); reconcile-on-snapshot integration; button visibility rules (hidden when empty / synced; visible when desynced or never-synced + non-empty)

---

## Phase 7 — Pull request linkage

**User stories**: 46–48.

### What to build

Pull request webhook events scan title, body, and branch name for `<PROJECT_KEY>-<NUMBER>` patterns (e.g., `ENG-42`). Each match inserts or updates a `taskPullRequestLinks` row pointing at the referenced task. PR state (open / draft / merged / closed) updates via webhook. Clicking a PR reference on the task detail opens it on GitHub in a new tab. PR references are read-only — there is no Ripple-side PR authoring surface.

### Acceptance criteria

- [ ] `pull_request` webhook events (opened, edited, closed, reopened) scan title, body, and branch for `<PROJECT_KEY>-<NUMBER>` patterns
- [ ] Each matched pattern inserts/updates a `taskPullRequestLinks` row
- [ ] Removing the key from a re-edited PR removes the corresponding row
- [ ] PR badge on task detail shows current state (open / draft / merged / closed) and links out to GitHub in a new tab
- [ ] PR state updates via webhook reflect within ~1 s
- [ ] Tests: regex matching across title / body / branch + multiple keys per PR; insert / update / delete cases driven by edit events; state transitions via webhook fixtures

---

## Phase 8 — Pause/resume + disconnect/reconnect

**User stories**: 63–66.

**Carried in from Phase 4**: self-service GitHub-username field on the user
profile / account settings page. Writes a `workspaceMemberExternalIdentity`
row (provider="github") per workspace the member belongs to. Phase 4 shipped
the mapping table + matcher; until this UI lands, members are silently
unmapped (inbound falls back to the bot user, outbound skips). No admin grid
— defer the discovery surface ("unmapped logins seen on inbound events →
assign to member") to a follow-up if needed.

### What to build

Workspace admins can pause a link without disconnecting it — sync stops in both directions and webhooks arriving during a pause are **dropped rather than queued** (so resuming doesn't fire a burst of stale events). Disconnect tears down the link rows but first writes a `tasks.externalRefFrozen` snapshot on each affected task so historical context (provider, repo, issue number, URL, disconnect timestamp) survives. Unlinking does not delete tasks. Reconnecting the same repo to the same project rehydrates by matching `externalIssueId` against `externalRefFrozen.issueId`. `installation.deleted` and `installation_repositories.removed` events from GitHub auto-transition the relevant links to `disconnected` and write the frozen refs first.

### Acceptance criteria

- [ ] Admin can pause a link from the workspace integrations tab; status → `paused`; sync stops both directions
- [ ] Webhooks arriving during pause are dropped (no queueing) but the dedup row IS written so retries don't re-enter
- [ ] Resume restarts sync; tasks created or changed during pause stay where they are (no catch-up)
- [ ] Disconnect writes `tasks.externalRefFrozen = { provider, repoFullName, issueNumber, issueId, url, disconnectedAt }` per affected task and hard-deletes `taskIntegrationLinks` / `taskCommentIntegrationLinks` / `taskPullRequestLinks` rows for that link
- [ ] Unlinking does NOT delete tasks; historical context survives on each task
- [ ] Reconnecting the same repo to the same project rematches existing tasks by `externalIssueId` against `externalRefFrozen.issueId`; new issues get fresh tasks
- [ ] `installation.deleted` / `installation_repositories.removed` events auto-transition the relevant links to `disconnected` (writing frozen refs first)
- [ ] Tests: pause drops webhooks but writes dedup row; disconnect-then-reconnect rehydrates link rows on `externalIssueId` match; `installation.deleted` → all links of that installation transition to disconnected with frozen refs

---

## Phase 9 — Entitlement freeze + Force resync + 24h banner

**User stories**: 55, 56, 59–62.

### What to build

When the workspace entitlement is revoked, both inbound and outbound sync freeze across all the workspace's links (an internal action fans out `pausedByBilling=true`). Restoring the entitlement runs the inverse fanout and auto-resumes every link — no manual re-activation. While frozen, the integration is visibly frozen (admin sees a clear "entitlement revoked" indicator on every link). A "Force resync" button per link reconciles drift caused by missed webhooks or extended freeze periods. After a freeze lasting more than 24 hours, a banner suggests running Force resync to catch up on changes GitHub stopped retrying.

### Acceptance criteria

- [ ] Entitlement flip false → internal action fans out `pausedByBilling=true` to every `projectIntegrationLinks` row in the workspace
- [ ] Entitlement flip true → inverse fanout flips `pausedByBilling=false`; previously-active links auto-resume to active
- [ ] Frozen links show a clear "entitlement revoked" indicator in workspace settings explaining why sync stopped and how to restore
- [ ] While frozen: inbound webhooks are dropped WITHOUT writing the dedup row (so GitHub retries can land if entitlement restores within retry window); outbound dispatch is rejected at the `core/syncOut` boundary
- [ ] "Force resync" button per link reconciles open/close state + label and assignee fields against GitHub current truth
- [ ] After a freeze of >24 h, a banner suggests "Force resync" on each affected link
- [ ] Tests: `core/entitlements` fanout on flip (both directions); freeze-time webhook drop does NOT write dedup row (contrast with pause); freeze-time outbound dispatch rejected; Force resync brings drifted state back into agreement
