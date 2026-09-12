# 04 — Read a project

**Parent:** `.scratch/assistant-reads/spec.md`

**What to build:** "@Assistant how is the billing project going" answers from the project's actual state on both surfaces. A new read-project tool in the shared **assistant tools** returns the project's fields plus up to 50 of its tasks with title and status, open tasks first, read through the identity-taking reads module as the **summoner**. Find-by-name already returns project ids. A project chip in the summoning message is preloaded the same way once 03 lands.

**Blocked by:** 02 — Chat assistant reads through tools.

**Status:** done

- [x] A tool read of a project returns its fields and its tasks, open first, capped at 50 with a note when truncated
- [x] A project from another workspace returns the refusal string
- [x] The writing assistant has the same tool with no further change
- [x] The guard test still passes: the new read goes through the identity-taking reads module
- [x] Tested through the chat send seam with the scripted mock model
