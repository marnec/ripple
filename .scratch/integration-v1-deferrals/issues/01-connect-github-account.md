# 01 — Connect your GitHub account from user settings

**What to build:** A workspace member who signed up by email (or Google, or
GitLab) can prove which GitHub account is theirs. In user settings a
"Connected accounts" section shows a GitHub row: either the connected
`@login` with a Disconnect button, or a Connect button. Connect sends them
through GitHub's authorize screen using the GitHub App's existing user
authorization, and they land back where they started with a "GitHub account
connected" notice. From then on, assigning them a task that is linked to a
GitHub issue pushes them as the issue's assignee, where today the push is
silently skipped for anyone who did not sign in with GitHub.

Mechanically this reuses the authorize round trip the install picker already
uses. The one-time nonce the callback consumes gains a purpose (install vs
identity); the callback reads the purpose and dispatches to either the
existing install finalizer or a new identity finalizer, which trades the code
for a user token, asks GitHub who the user is, discards the token, and writes
the login onto the account-level user row that the assignee matcher already
consults. Nothing about workspace-level identity overrides changes.

Spec: `plans/integration-v1-deferrals.md`, plan A.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] A member with no GitHub sign-in connects GitHub from user settings and
      their canonical (lowercase) login is stored on their user row.
- [x] After connecting, assigning that member to a task linked to a GitHub
      issue enqueues an assignee push and the issue shows them as assignee.
- [x] Before connecting, the same assignment is skipped exactly as today.
- [x] Any workspace member can connect; the flow is not admin-gated.
- [x] Connecting a login another user already holds is refused with a clear
      error and neither user's row changes.
- [x] Disconnect clears the stored login; the next assignee push for that
      member is skipped again.
- [x] A nonce started for an install cannot complete an identity connect and
      vice versa; a replayed callback fails.
- [x] The success and error outcomes surface as the same kind of notice the
      install callbacks already show, using distinct query flags so they never
      collide with the install picker's flag.
- [x] Backend tests cover the connect and disconnect mutations, duplicate
      refusal, purpose isolation, and the finalizer with a mocked GitHub.
