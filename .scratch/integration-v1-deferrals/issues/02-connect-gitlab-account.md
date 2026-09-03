# 02 — Connect your GitLab account

**What to build:** The GitLab row in the "Connected accounts" section works
the same way as the GitHub row from ticket 01. Connect sends the member
through GitLab's authorize screen with a read-only user scope (not the API
scope the workspace install asks for), and on return stores both the numeric
GitLab user id and the lowercase username on their user row. GitLab
addresses assignees by id and mentions by username, so both are needed.
After connecting, inbound GitLab assignee changes resolve to the member and
outbound assignments push them by id.

Reuses the PKCE round trip the GitLab workspace install already runs, with
the nonce purpose from ticket 01 driving the callback's branch. The
authorize URL builder gains a scope option; the default stays as it is for
installs.

Spec: `plans/integration-v1-deferrals.md`, plan A.

**Blocked by:** 01 — Connect your GitHub account from user settings.

**Status:** done

- [x] A member connects GitLab from user settings; their GitLab user id and
      username are stored on their user row.
- [x] The authorize request asks only for the read-user scope.
- [x] After connecting, assigning that member to a task linked to a GitLab
      issue pushes them by id, and an inbound assignee change naming their id
      resolves to them.
- [x] Connecting an id another user already holds is refused; Disconnect
      clears both fields.
- [x] Install and identity nonces stay isolated, as in ticket 01.
- [x] The success and error notices appear with GitLab wording.
- [x] Backend tests cover the GitLab finalizer with a mocked GitLab and the
      scope on the authorize URL.
