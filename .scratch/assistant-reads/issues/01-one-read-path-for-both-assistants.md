# 01 — Prefactor: one read path for both assistants

**Parent:** `.scratch/assistant-reads/spec.md`

**What to build:** The writing assistant behaves exactly as it does today, but its read tools (find by name, read document, read task, read channel messages) come from a shared **assistant tools** factory that takes a workspace id and a **summoner** user id, and every read those tools make goes through a new backend module of identity-taking internal queries. Each internal query delegates to the same access helper its public twin uses: the workspace rule for documents and tasks, the channel rule for messages, the shared collaboration-access check for snapshot URLs. The writing assistant's HTTP action resolves the user from auth and passes it into the factory; there is no identity-from-auth logic inside any tool. The public queries are unchanged. A source-scan guard test, in the style of the trigger write guard, fails if the factory reaches data through anything other than that module. No user-visible change.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] The factory takes workspace id, summoner id, and the per-read clip size as parameters and returns the tool set; the writing assistant keeps its current 8 steps and 60,000-character clip
- [x] A new module holds one internal query per read, each taking a user id and applying the same rule as the corresponding public query
- [x] Every tool returns the single undifferentiated "not found, or you do not have access to it" for missing, deleted, foreign-workspace and access-denied resources
- [x] A resource with no stored snapshot reads as empty text, not as a refusal
- [x] Guard test: the factory's source reaches data only through the identity-taking reads module and imports no public query
- [x] The writing assistant's existing HTTP access tests pass unchanged
- [x] Access tests for the internal reads cover: a summoner outside a private channel is refused; a document id from another workspace is refused; a member reads their own workspace's document
