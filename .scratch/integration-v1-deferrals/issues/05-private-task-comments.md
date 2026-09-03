# 05 — Private task comments

**What to build:** On a task linked to an external issue, the comment
composer offers two lanes: **Private note** (the default) and **Reply on
GitHub** (or GitLab, named after the linked provider). A private note stays
in Ripple: it is never pushed, gets no provider link, and shows a small lock
"Private" chip in the timeline. A reply behaves exactly as comments do today.
The lane is chosen when posting and cannot be changed afterwards. On a task
with no linked issue the control is hidden and comments carry no lane at
all. Comments arriving from the provider are never private.

This mirrors Linear, where the synced thread is the explicit place to talk to
GitHub and everything else on the issue is a private team discussion.

Spec: `plans/integration-v1-deferrals.md`, plan B.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] On a linked task, posting with the default lane creates a comment with
      no provider link row and no outbound run.
- [x] Posting with the reply lane creates the provider comment as today
      (idempotency marker appended, link row written on success).
- [x] Editing a private comment never enqueues an outbound run, even when a
      link row is inserted by hand in a test.
- [x] Deleting a private comment is a no-op on the provider side.
- [x] On an unlinked task the control is not rendered and stored comments
      have no lane field.
- [x] Inbound comments are never marked private.
- [x] The comment list exposes the lane so the timeline can render the chip;
      Ctrl+Enter respects the selected lane.
- [x] Existing comment rows (no lane field) keep behaving as public.
