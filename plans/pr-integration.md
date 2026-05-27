# Plan: Pull Request / Merge Request Integration

> Source PRD: grilled-out spec (2026-05-21), `github-integration` branch. See memory `project_github_pr_integration_design.md`.

## Architectural decisions

Durable decisions that apply across all phases:

- **Conceptual model**: A PR/MR is an **attachment on a task**, never its own task. **Inbound, read-only** — Ripple never writes to the host.
- **Linking**: via the host's native **closing references** ("Closes #N"), resolved with **GraphQL** inside the github adapter (the REST-only client gains a GraphQL path). Core receives already-resolved external issue IDs + normalized state.
- **Canonical noun**: `pullRequest` in core/schema (GitLab `merge_request` → `pullRequest`; UI labels per provider). All `core/*` logic and tables stay provider-neutral; per-adapter responsibility is webhook normalization + closing-ref resolution.
- **Schema**:
  - `pullRequests` — one row per external PR: `workspaceId`, `projectIntegrationLinkId`, `provider`, `externalPrId` (node id), `number`, `title`, `url`, `state` (`draft`|`open`|`merged`|`closed`), `headRef`, `baseRef`, `externalAuthor {login, avatarUrl, url}`, `externalUpdatedAt` (ordering guard), `mergedAt?`. Indexes: `by_link_externalPrId`, `by_workspace`.
  - `taskPullRequestLinks` — join `taskId` ↔ `pullRequestId`. Indexes: `by_task`, `by_pullRequest`.
  - `projectIntegrationLinks.branchStatusMap?` — optional `Array<{ branch: string, statusId: Id<"taskStatuses"> }>`.
- **App config**: declare `pull_requests: read` permission + subscribe to the `pull_request` webhook event up front (no existing installations → no migration path).
- **Automation model**: forward-only, **most-advanced-wins** ranked by `status.order`; desired status is derived from **all** of a task's linked PRs. A matching branch→status rule is **authoritative** over the existing `issues.closed` completion path (which becomes the fallback). Status is **never auto-reverted**.
- **Reused infrastructure**: existing freeze/entitlement gate, `externalUpdatedAt` idempotency/ordering guards, bot-user/`externalAuthor` display pattern.

### Out of scope for v1 (deferred)
- Reviews + CI/checks (state only).
- Glob branch patterns (exact match only).
- Direct-push triggers (PR-merge only).
- Backfill of pre-existing open PRs (webhook-going-forward only).
- PR comments are intentionally **not** synced (existing orphan-drop path handles this).

---

## Phase 1: Tracer bullet — PR attaches & displays

**User stories**: As a developer, when I open a PR whose body says "Closes #N", I see that PR linked on the Ripple task imported from issue #N, showing its state, branch, and a link.

### What to build

The thinnest complete path through every layer. Add the two schema tables. Subscribe the GitHub App to `pull_request` and handle the **`opened`** action: normalize it to a provider-neutral `pullRequest.opened` event, resolve the PR's `closingIssuesReferences` via a new GraphQL call on the github client, map each referenced issue's external id to a `taskIntegrationLinks` row, and create/attach `pullRequests` + `taskPullRequestLinks`. Surface a "Pull requests" section in the task detail sheet listing attached PRs (number, title, state, branch, link). **No status automation in this phase** — attachment and display only.

### Acceptance criteria

- [ ] `pullRequests` and `taskPullRequestLinks` tables exist with the indexes above; schema validates.
- [ ] GitHub App requests `pull_requests: read` and receives `pull_request` deliveries.
- [ ] A `pull_request.opened` whose body closes an imported issue creates one `pullRequests` row and a `taskPullRequestLinks` row to the correct task.
- [ ] Closing refs are resolved via GraphQL (catches body keywords AND Development-sidebar links).
- [ ] A PR closing an issue that is NOT imported, or in an unlinked repo, is ignored (no row created).
- [ ] The task detail sheet shows attached PRs with state/branch/link; tasks with no PR show nothing.
- [ ] Backend tests cover: attach on opened, multi-issue PR (attaches to multiple tasks), orphan/unlinked PR ignored, freeze-gate drops events for non-active links.

---

## Phase 2: Full PR lifecycle mirroring

**User stories**: As a team member, the PR's state on the task stays accurate as it progresses (draft ↔ ready, merged, closed); stale links disappear when the PR no longer references the issue.

### What to build

Handle the remaining `pull_request` actions: **edited** (re-resolve closing refs → attach newly-referenced tasks, detach dropped ones), **closed** (set `state` to `merged` when the merged flag is true, else `closed`; record `mergedAt`/`baseRef`), **reopened**, **ready_for_review** and **converted_to_draft** (toggle `draft`/`open`). Ignore `synchronize`. Mirror closing references on every event. Cascade-detach `taskPullRequestLinks` when a task or PR is deleted. Add an explicit `issue.pull_request` guard in the comment normalizer so PR comments are dropped clearly. Add a small PR icon + state indicator on the kanban/list card. Still **no status automation**.

### Acceptance criteria

- [ ] Each action updates `pullRequests.state` correctly; `merged` vs `closed` distinguished by the merged flag.
- [ ] `edited` re-resolution attaches late-added "Closes #N" tasks and detaches issues removed from the closing refs.
- [ ] Out-of-order / stale events (older `externalUpdatedAt`) are dropped; redelivered events are idempotent.
- [ ] Deleting a task or PR cascades to remove the join rows; closed-unmerged PRs keep their attachment.
- [ ] PR comments (`issue_comment` on a PR) are dropped via the explicit guard; issue comments still sync.
- [ ] Card shows a PR/state indicator; detail section reflects live state.
- [ ] Tests cover every action, ordering guard, idempotency, cascade-detach, and the PR-comment guard.

---

## Phase 3: "PR opened → In Progress" automation

**User stories**: As a developer, opening a PR (even a draft) automatically moves my task into the "started" status, so the team sees work has begun without me shuffling the ticket.

### What to build

Introduce the shared **derive-desired-status** function: given a task and all its linked PRs, compute the target status forward-only and most-advanced-wins by `status.order`. Wire the hardcoded rule: any linked non-merged PR (draft or open) → move the task to the project's `setsStartDate` status, but only if the task's current `status.order` is earlier and the task isn't completed. Graceful no-op when the project has no `setsStartDate` status. Recompute on the relevant PR events from Phases 1–2.

### Acceptance criteria

- [ ] Opening a PR on a triage/unstarted task moves it to the `setsStartDate` status.
- [ ] A task already at/after the started status, or completed, is left untouched (forward-only).
- [ ] Projects without a `setsStartDate` status get a clean no-op (no error).
- [ ] Multi-PR: a task with several PRs resolves to one stable status regardless of event order.
- [ ] Status is never reverted by draft toggles or closed-unmerged.
- [ ] Tests cover forward-only guard, no-op, multi-PR most-advanced-wins, and non-reversion.

---

## Phase 4: Branch → status automation + config

**User stories**: As a workspace admin, I map branches to statuses for a repo (e.g. `develop` → On Staging, `main` → Released). As a developer, when a PR merges into a mapped branch, the linked task automatically moves to the corresponding status, broadcasting "this is on staging/in prod now" to the team.

### What to build

Add `branchStatusMap` to `projectIntegrationLinks` plus mutations to edit it. Build a settings editor in the project integration settings: rows of `[branch ▾] → [status ▾]`, where the branch dropdown is populated from the repo's branches via the host API (with a free-text fallback for branches that don't exist yet). Extend the derive-desired-status logic: on a PR **merge**, exact-match the PR's `baseRef` against `branchStatusMap`; a match is **authoritative** and contributes its mapped status to the ranking. Make `issues.closed` completion the **fallback** that applies only when no branch rule matched the merge. If the mapped status `isCompleted`, the task completes naturally.

### Acceptance criteria

- [ ] `branchStatusMap` persists on the project-repo link; admins can add/edit/remove rows.
- [ ] Branch dropdown lists the repo's branches; free-text entry is accepted.
- [ ] Merging a PR into a mapped branch moves linked tasks to the mapped status (forward-only, most-advanced-wins).
- [ ] When a branch rule matches a merge, `issues.closed` does NOT also move the task (rule wins); when no rule matches, `issues.closed` still completes the task (fallback).
- [ ] Merging into an unmapped branch produces no branch-driven transition.
- [ ] A mapped status that is `isCompleted` sets the task completed.
- [ ] Tests cover: rule-wins precedence, fallback path, unmapped branch, forward-only across a dev→staging→prod pipeline, and completion via a mapped completed status.
