# 02 — Chat assistant reads through tools (fetched context)

**Parent:** `.scratch/assistant-reads/spec.md`

**What to build:** "@Assistant what does the Roadmap document say" works in a channel with no reference chip. The chat reply builds the **assistant tools** with the **summoner** it already carries, runs up to six steps with a 30,000-character clip per read, and its instructions describe the tools, the summoner-access boundary, the instruction to say plainly when something cannot be found or read, and the Sources rule: end the reply with a "Sources" line naming resources read through tools, omitted when nothing was fetched. The model's transcript renders each reference chip inline as its name followed by the resource type and id, so chips from earlier messages are reachable by tool; what people see and the stored plain text are unchanged. Nothing changes about when the assistant answers.

**Blocked by:** 01 — Prefactor: one read path for both assistants.

**Status:** done

- [x] A mention with no chip that asks about a document by name gets a reply grounded in that document, ending with a Sources line naming it
- [x] A tool read of a private channel the summoner is not in returns the refusal string and the reply is still posted, saying it could not access it
- [x] A tool read of a document from another workspace returns the refusal string
- [x] A document with no snapshot reads as empty and the reply says so
- [x] A document over the clip limit is truncated with a marker and the reply still answers
- [x] A reply that reaches the step limit still posts an answer
- [x] Chips in earlier transcript messages appear to the model as name, type and id
- [x] Feature off and rate limit spent still produce no reply; the rate limit is consumed once per reply regardless of steps
- [x] One usage row per model step is recorded
- [x] The line "you can only see this channel's messages" is gone from the instructions
- [x] All of the above are tested through the chat send seam with the scripted mock model, asserting on the posted reply and on the second model call's prompt
