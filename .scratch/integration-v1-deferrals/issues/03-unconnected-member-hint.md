# 03 — Admins can see which members haven't connected

**What to build:** In the workspace members list, when the workspace has an
active integration for a provider, each member who has no identity for that
provider shows a muted "Not connected to GitHub" (or GitLab) hint. It tells
an admin at a glance why assignee sync is not reaching someone, and what
that person has to do. It is a nudge only: there is no admin write path, the
member still has to connect from their own settings.

Spec: `plans/integration-v1-deferrals.md`, plan A.

**Blocked by:** 01 — Connect your GitHub account from user settings.

**Status:** done

- [x] With an active GitHub integration, members lacking a GitHub identity
      show the hint; members with one do not.
- [x] With no active integration for a provider, no hint for that provider
      is shown for anyone.
- [x] Both providers can show independently on the same member.
- [x] The hint disappears reactively once the member connects.
- [x] The members query does not add a per-member round trip; identity
      presence comes from fields already on the member's user row.
