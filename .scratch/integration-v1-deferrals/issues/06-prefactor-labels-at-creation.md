# 06 — Prefactor: labels travel with issue creation in both directions

**What to build:** An issue that is opened, reopened, or imported with labels
already on it becomes a task carrying those tags immediately. Today the
opened event and the import path carry no labels, so tags only arrive if a
later "labeled" webhook happens to follow. In the other direction, creating
an issue from a tagged task sends the tags in the create call itself; today
the create sends only title and body and the tags trickle over on a later
edit, if ever.

Both halves seed the task link's mirror of the provider's label set at
creation, so the burst of per-label webhooks GitHub emits right after an
opened-with-labels issue (and right after our own create) hits the existing
echo guard instead of re-reconciling tags and spamming the activity log.
Both providers create missing labels on the issue endpoint for a token with
write access, so no separate label-creation step is needed.

This is a prefactor: it closes an existing gap on its own and is what makes
the priority-label tickets small.

Spec: `plans/integration-v1-deferrals.md`, plan C (schema and outbound
sections on the normalized event and the create call).

**Blocked by:** None — can start immediately.

**Status:** done

- [x] An opened webhook for an issue with labels produces a task whose tags
      match, with the dictionary and join rows reconciled, and whose link
      row mirrors the provider's label set.
- [x] An import of labeled issues does the same for every imported issue.
- [x] A reopened event carries labels the same way.
- [x] The per-label "labeled" webhooks that follow an opened-with-labels
      issue are dropped by the echo guard: no second reconciliation, no
      extra activity entries.
- [x] Creating an issue from a tagged task sends the tags in the create call
      for both GitHub and GitLab; on success the link row mirrors the sent
      set so the bounce-back webhooks are suppressed.
- [x] Creating an issue from an untagged task sends no labels and behaves as
      today.
- [x] Existing sync-in and sync-out tests still pass unchanged.
