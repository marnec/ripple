# Plan: T6 — scheduled work with no retry, no continuation, no failure surface

> Source: backend audit (11 Aug 2026), theme **T6** — the last open theme. T4 closed the
> unbatched-rewrite theme by turning three inline bulk rewrites into paged drains; T6 governs what
> happens when one of those drains, or an email, fails halfway. Phase 0 is already in the working
> tree as a spike.

## The one fact the whole theme rests on

Convex 1.43.0: a scheduled **mutation** is exactly-once — Convex retries internal errors itself and
only a developer throw kills it. A scheduled **action** is **at-most-once with no retry**, and its
failure is invisible except in `_scheduled_functions` (7-day retention) and the logs.

Every site in this theme is a scheduled *action*. That is the defect; the rest is which mechanism
replaces it where.

## Architectural decisions

Durable decisions that apply across all phases.

- **Durability is bought, not built.** `@convex-dev/resend` 0.2.6 is internally
  `@convex-dev/workpool` + `@convex-dev/rate-limiter` with Resend idempotency keys — the design we
  would otherwise hand-roll, maintained. `@convex-dev/workflow` is **not** adopted: these are
  single-step convergent loops, not sagas, and durable per-step state buys nothing here.
- **Enqueue inside the caller's transaction.** `resend.sendEmail` accepts a `MutationCtx`, so the
  mail commits with the row that caused it. The invariant is *no invite without a queued mail, and
  no queued mail without an invite* — the old `scheduler.runAfter(0, internal.emails.*)` gave only
  the first half, because the schedule was atomic but the send was a separate at-most-once action.
- **`testMode` is an explicit deployment decision.** The component defaults it to `true` and then
  **rejects** any address outside `{delivered,bounced,complained}@resend.dev`; with a transactional
  enqueue that rejection rolls back the invite. Neither value gets to be a default: `resolveTestMode()`
  throws when the variable is unset, on the send path rather than at import time.
- **Attachments split the email work in two.** The component's batch endpoint carries no
  attachments, and all three calendar mails attach an ICS whose `ORGANIZER` is the entire RSVP
  ingestion path. Calendar mail therefore uses `sendEmailManually` — the component's record and
  webhook status, our own workpool for the retry it does not provide.
- **Retry belongs to the pool; restart-safety belongs to the page.** A retried drain restarts from
  `cursor: null`. That is safe only because each page converges rather than accumulates
  (`insertSubscription`/`deleteSubscription` read before writing; T4's pages select only rows still
  disagreeing). This is a property of the page function, and it is what makes plain retry sufficient
  instead of persisted cursors — so it is stated at each site, not assumed.
- **A failure surface is a column on a row a screen already renders**, not a log line. The
  component's own record stays the source of truth; what we denormalize is only what a list view
  needs without a per-row component read.
- **Push notifications stay at-most-once, on purpose.** `deliverPush` is the one site in this theme
  that does *not* get retry: a duplicate push is worse for the recipient than a missed one, and no
  dedupe key exists on the delivery side. Boundary stated here so it is not "fixed" later.

### Out of scope

- `@convex-dev/workflow`.
- Retry for `deliverPush` (see above).
- Convex Auth's own Resend OTP provider — separate wiring, unchanged.
- Anything in the audit's Correctness / API-misuse sections that is not a failure-handling defect.

---

## Phase 0: Spike — invite mail through the component *(in the working tree, uncommitted)*

### What was built

`@convex-dev/resend` 0.2.6 mounted; `emailDelivery.ts` (lazily-built client, `apiKey` from the
existing `AUTH_RESEND_KEY`, `resolveTestMode`), `emailEvents.ts` (the `onEmailEvent` sink),
`emailTemplates.ts` (invite body + `escapeHtml`, in a plain module so a mutation can render it);
three delivery columns + `by_delivery_email` on `workspaceInvites`; `/resend-webhook` route; all
three invite call sites enqueue in-transaction.

### What it proved

- [x] The component works under `convex-test` (registers via its `./test` export; mutations enqueue).
- [x] The enqueue is transactional — a mutation that throws after the enqueue point leaves zero rows
      and zero queued mail.
- [x] `testMode: true` rejects real addresses at enqueue and rolls the invite back.
- [x] The webhook sink lands a bounce reason on the invite row.
- [x] 1,207 backend tests green, `tsc` clean across all five packages.

### Carried forward

`npx convex codegen` pushes to the dev deployment (static codegen makes it unavoidable), so dev ran
the new code before `RESEND_TEST_MODE` existed and invites threw until it was set to `false` —
matching dev's prior behaviour, which already sent real mail from a real key. **The same hazard
applies to prod in reverse: set `RESEND_TEST_MODE` before the deploy that introduces this code, or
every invite throws.**

---

## Phase 1: Finish the invite path

### What to build

Delete `emails.sendWorkspaceInvite`, now unused, and make `emails.ts` import `escapeHtml` from
`emailTemplates.ts` so the "every interpolated value goes through this" invariant is one grep across
both senders rather than two copies.

Wire the webhook for real: a Resend dashboard endpoint per deployment
(`https://<deployment>.convex.site/resend-webhook`) with all `email.*` events enabled, and
`RESEND_WEBHOOK_SECRET` set on each. Two deployments, two endpoints, two secrets — the same shape as
the RTK transcription webhooks.

Add a retention cron: the component keeps finalized emails 7 days and abandoned ones 30, and stores
`html` — which for calendar mail (Phase 2) means event titles and descriptions at rest.

Then, and **only** after the webhook is live, surface delivery on the invite lists (workspace and
admin): `bounced`/`failed` renders the reason beside the existing resend action. Before the webhook
exists `deliveryStatus` never advances past `waiting`, so shipping the column first would show every
invite as permanently pending.

### Acceptance criteria

- [x] `emails.sendWorkspaceInvite` is gone; `emails.ts` imports `escapeHtml` from `emailTemplates.ts`;
      no second copy of the escape exists. The two escaping regressions it carried moved to the new
      seam — the queued component record — with their assertions unchanged.
- [ ] `RESEND_WEBHOOK_SECRET` set on dev and prod; a real Resend delivery event advances a real
      invite row to `delivered`. **Needs the Resend dashboard — the only step not yet done.**
- [x] Retention cron (`emailMaintenance.pruneEmailRecords`, daily 04:30 UTC) runs both component
      cleanups; a record past the window is removed and one inside it is left alone.
- [x] Invite lists render `bounced`/`failed` with the reason; `waiting`/`queued`/`sent` render as
      nothing (an in-flight email is not news).
- [x] Tests: bounced → row carries the reason; an event for an unmatched email id is ignored rather
      than throwing.

### Found while building

- **`email.failed` was unhandled.** Resend distinguishes a *bounce* (rejected after acceptance) from
  a *failure* (rejected instead of it — unverified domain, bad payload). The sink only knew about
  bounces, so the second class never reached the row despite having the identical symptom. Now both
  land as a delivery notice.
- **The component schedules no cleanup of its own** — it exposes `cleanupOldEmails` /
  `cleanupAbandonedEmails` and leaves the policy to the app. The cron is therefore not hygiene, it is
  the only thing bounding those tables. Both mutations self-page, so one call per window suffices.
- **The delivery mapper went to `packages/shared`, not `apps/web/src/lib`.** The admin console needs
  the same mapping, and two copies would let the consoles disagree about what a status means.
  `stableRef` is the precedent: shared module, test in the web suite (the shared package has no
  runner).

---

## Phase 2: Calendar mail (6 call sites)

### What to build

A dedicated `emailPool` workpool instance — separate from `notificationPool` so a Resend outage's
backlog cannot starve push delivery — with `retryActionsByDefault: true`,
`defaultRetryBehavior: { maxAttempts: 5, initialBackoffMs: 2_000, base: 2 }` and a modest
`maxParallelism` (the component itself paces at one call per 600ms; ours should not race it).

The three `sendEvent*` actions keep rendering the body and the ICS, but send via
`resend.sendEmailManually`, passing a Resend `idempotencyKey` **scoped per attempt**. Per-attempt,
not stable across attempts: a stable key makes Resend return the same email id for two component
records, and the webhook resolves events by `resendId` with `.first()`, so status would land on a
record nobody reads. The cost of per-attempt keys is a genuine double-send in the narrow window
where a send succeeded but the response was lost — acceptable for a calendar invite, which is
idempotent to the recipient, and not acceptable for anything transactional (noted here because the
next reader will want to copy this).

`sendEmailManually` rethrows after recording, so the pool's retry composes — but each attempt
creates its own email record. Delivery state on `calendarEventInvitees` is therefore
**newest-record-wins**, never `.unique()`.

Error classification, replacing today's single `ConvexError` for everything: Resend's typed
`RESEND_ERROR_CODE_KEY` union maps `validation_error` / `invalid_from_address` / `not_found` /
`invalid_parameter` / quota codes to `NonRetryableError` (stop immediately — five attempts against a
malformed address is five identical failures), and `rate_limit_exceeded` / 5xx / network to a throw.

`calendarEventInvitees` gains the same three delivery columns as `workspaceInvites`.

### Acceptance criteria

- [x] All six calendar call sites go through `emailPool`; no `scheduler.runAfter(0, internal.emails.*)`
      remains anywhere.
- [x] The ICS attachment and its `ORGANIZER` are pinned by a test — filename, `text/calendar`
      content type, `METHOD`, `UID`, the RSVP organizer address and CRLF endings.
- [x] A 429 throws a plain error so the pool backs off and leaves the row alone; a `validation_error`
      throws `NonRetryableError` and records the reason.
- [x] Both outcomes land on the invitee row.
- [x] Guest and member rows both carry delivery state, resolved once per dispatch rather than per
      recipient (`loadInviteeIndex`).
- [x] The event detail surfaces it, through the same `inviteDeliveryNotice` mapper the invite lists
      use — icon-only beside the RSVP badge, failures only, reason in the tooltip.

### Found while building

- **The workpool *does* drain under `convex-test`** — `finishAllScheduledFunctions(vi.runAllTimers)`
  runs enqueued actions end-to-end. Verified with a throwaway probe before rewriting any assertion.
  That is the second and decisive disproof of the premise behind the three `process.env.VITEST`
  shims, and it makes phase 3's first task a deletion rather than an investigation.
- **The idempotency key did not need inventing.** The component mints a fresh `emailId` per attempt
  and hands it to the `sendEmailManually` callback, so using it as the Resend idempotency key is
  per-attempt *by construction* — no attempt counter to thread through, and no way for a future
  caller to accidentally make it stable.
- **Nothing covered the ICS before this pass.** The RSVP ingestion path
  (`packages/rsvp-worker` parses `METHOD:REPLY` keyed on the UID and organizer address) had zero
  regression protection, on a change whose most likely failure mode is silently dropping the
  attachment.
- **Two test files asserted on `_scheduled_functions` rows named `emails:sendEvent*`.** Those rows
  no longer exist. Retargeted onto what the assertions always meant — drain the pool, count what
  reached Resend — rather than deleted.
- **`calendarEvents.get` failed on arrival of the new columns.** Its invitee validator is strict and
  the rows are returned whole, so the delivery fields had to be declared there too. Worth
  remembering for phase 3: a persisted column is also a read-validator change. (It happened twice —
  again on `deliveryResendId`, which is stripped in the resolver rather than declared: a provider
  correlation id is of no use to a client.)
- **The component's `onEmailEvent` never fires for manual sends on a deployment that has not used
  the batch path.** Found by checking the row after a real dev send: the invitation arrived in an
  inbox while its row sat at `sent` forever. The cause is in the component
  (`lib.ts`, `enqueueCallbackIfExists`) and its own comment says it — the `lastOptions` row holding
  the callback reference is written *only* by `scheduleBatchRun`, reached only from `sendEmail`.
  Calendar mail is manual, so its delivery events were verified, matched, and discarded in silence.
  Confirmed by sending one workspace invite, after which the next calendar send tracked to
  `delivered` with no code change.

  The dependency — "calendar tracking works provided somebody sent an invite first" — is precisely
  the kind of implicit ordering this theme exists to delete, and it was live on prod, which has never
  run `sendEmail`. Closed by making the route self-sufficient: the send stamps Resend's own message
  id on the row (`deliveryResendId`), and the webhook route resolves events by it directly, after
  the component has verified the signature and accepted the request. `onEmailEvent` is now
  redundancy rather than the only wire, and both paths apply the same patch — safely, since the
  patch is a function of the event alone.
  **Worth reporting upstream**: `createManualEmail` should register options the way `sendEmail` does.

---

## Phase 3: The drains

### What to build

Delete the `process.env.VITEST` branches in `notificationPool.ts`, `taskReassignPool.ts` and
`taskImportPool.ts`. Their premise — that component mutations do not work under `convex-test` — was
disproven by the Phase 0 spike, and the harness has registered all three pools since T4. Leaving them
would make every retry setting below untestable, which is exactly the shim T4 removed from the fanout.

Route the three notification-subscription drains (`publicChannelCreated` / `channelMadePublic` /
`channelMadePrivate`, scheduled straight from `dbTriggers.ts`) through a pool with `retry: true`,
alongside the three that already go through `taskReassignPool` (`taskStatuses.syncTasksCompleted`,
`tagSync.stripTagEverywhere`, `reassignTasksAndDelete`) which need only the retry option.

Give each an `onComplete` that records terminal failure. Where: one small `backgroundJobFailures`
table (`kind`, `key`, `error`, `failedAt`) rather than a column per drain — these have no single row
to hang off, and an admin-visible list of "work that gave up" is the surface T6 actually asks for.

At each site, a comment stating *why restart-from-scratch is safe here* — convergent pages, not
accumulating ones — since "copy the sibling" is what the next reader will try.

### Acceptance criteria

- [x] No `process.env.VITEST` branch remains in the pool wrappers.
- [x] A page that throws mid-drain is retried and the drain converges to the same end state as an
      uninterrupted run (test drives a failure on page 2 of 3).
- [x] Retry exhaustion writes a `backgroundJobFailures` row naming the drain and its key.
- [x] Each drain entry point carries its restart-safety note.
- [x] `deliverPush` is unchanged, with the at-most-once decision recorded at the call site.

### Found while building

- **The subscription drains got their own pool instance**, not a second policy inside
  `notificationPool`. Sharing it would have put a retrying, backing-off drain in the one pool whose
  correctness rests on nothing in it ever being retried — and left a fanout backlog occupying the
  parallelism slots push delivery needs. Same argument as `emailPool`, same conclusion.
- **Deleting the three shims cost four test files, exactly as phase 2 predicted.** Assertions that
  counted `_scheduled_functions` rows named `notifications:deliverPush` had nothing to count once
  push went through the pool for real. Retargeted onto what they always meant — drain the pool, look
  at what reached delivery — through a shared `tests/pushProbe.ts`, so the next pooled path has one
  place to plug into rather than four private helpers.
- **A persisted column is also two generated-type edits.** `staticApi`/`staticDataModel` means a new
  table and a new internal function do not exist to `tsc` until `_generated/api.d.ts` and
  `_generated/dataModel.d.ts` say so, and `npx convex codegen` pushes to the dev deployment. Both
  files were hand-edited to match what codegen will produce; the next `convex dev` regenerates them
  identically.
- **The retry test had to be built so it could fail.** The obvious version — fail one page, assert
  the end state — passes whether or not a retry happens, because with three members the first page
  does all the work. It is therefore two tests: fail the *first* page (nothing committed, so an
  unretried drain leaves zero subscriptions) and fail *page 2 of 3* (page 1 committed, so the retry
  replays it and any lost idempotency shows up as duplicate rows).
- **Not every drain has a mockable page.** The subscription fanout calls a plain exported function,
  so failure injection is a module mock. `tagSync.stripTagBatch` calls nothing but `ctx.db`, so its
  test drives the failure with data instead: a join row pointing at a row of another table makes the
  strip's patch fail schema validation on every attempt — which is also a more honest rehearsal of
  what an undrainable batch looks like in production.
- **No admin surface yet.** The table is the failure surface this phase promised; a screen that
  lists it is a separate, small piece of work and is not in these criteria.

---

## Phase 4: The outbound recorder

### What to build

`runOutboundAction.ts:46` calls `sink.recordSuccess()` outside any guard, and the file's own contract
is "throw → the retrier retries". A recorder failure after a committed POST therefore re-POSTs a
non-idempotent create: an orphaned GitHub issue or a duplicated comment, unrecoverable from Ripple.

Wrap `recordSuccess` in its own bounded retry so a recorder failure can never re-enter `call`, and
for creates pre-search the existing `<!-- ripple-task: … -->` marker before POSTing. The existing
`@convex-dev/action-retrier` wiring stays as it is.

### Acceptance criteria

- [x] A recorder-mutation failure does not re-run the gateway call (test with a spy sink that throws).
- [x] A create whose marker already exists on the host resolves to the existing issue instead of
      creating a second one.
- [x] The retrier's return-vs-throw contract in the file header still describes what the code does.

### Found while building

- **A swallowed recorder is a silent lie, so it got the Phase 3 surface.** `recordSuccess` now
  retries (100ms, 400ms) and then reports to `backgroundJobFailures` through an optional
  `recordAbandoned` on the sink port — `integrations.outbound:<op>` keyed on the row whose mirror is
  now behind the provider. Without it the choice is between a duplicate issue and an invisible
  desync; with it, neither.
- **`recordPermanentFailure` is deliberately *not* wrapped.** A permanent failure means the provider
  rejected the write, so a retry has nothing to duplicate — it is rejected again. The asymmetry is
  noted at the call site because it reads like an oversight.
- **The pre-search lists, it does not search.** GitHub's issue search index is asynchronous, so an
  issue created seconds ago — the only issue this lookup ever wants — is routinely not yet findable.
  Both gateways therefore scan one created-desc page (50) and match the marker exactly. `/issues`
  also returns pull requests, which are filtered out.
- **The lookup's answer collapses to three cases, not four.** `OutboundLookup` is
  `found | absent | unavailable`: only a definite hit skips the POST, and a rate-limited lookup and
  a forbidden one are the same non-answer. Keeping the collapse in the *type* is what stops a later
  reader inventing a policy where a degraded search blocks a user-initiated create.
- **`findIssueByRippleTask` is required on the port, not optional.** An optional method is a guard a
  third provider can ship without; a required one is a compile error.
- **The retrier hands the action no attempt number**, so the pre-search runs on every create rather
  than only on retries — one extra GET per issue creation, which creates are rare enough to afford.

---

## Risks

- **Deploy ordering.** `RESEND_TEST_MODE` must exist on a deployment *before* the code that reads it
  lands, or every invite mutation throws. It is not a feature flag; it is a required variable.
- **`npx convex codegen` pushes.** Static codegen means routine type regeneration deploys to the
  configured dev deployment. Any phase touching the schema changes dev the moment types are
  regenerated.
- **Component tables at rest.** Calendar bodies contain event titles and descriptions; Phase 1's
  retention cron is what bounds that, so it is not optional once Phase 2 lands.
- **The component's version is a storage contract.** `emailDeliveryStatus` in `schema.ts` mirrors the
  component's `Status` union deliberately rather than importing it — a component bump that adds a
  status must land in that list, or historical rows fail validation.
