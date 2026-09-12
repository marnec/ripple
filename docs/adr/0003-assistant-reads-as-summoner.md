# Assistant reads act as the summoner

> Status: accepted, not yet implemented.

When the workspace assistant reads a resource to answer a chat mention — a
document, a task, a project, another channel's messages — it does so with the
access of the person who mentioned it, the **summoner**, not with an identity
of its own. The reply job runs as a scheduled action with no auth identity, so
this is not what falls out of the code by default: the summoner's user id is
carried into the job and every read tool takes it as an argument and applies
the same rule the public query would apply to that person.

## Considered Options

**The assistant as a workspace member of its own — rejected.** It would reach
every workspace-rule resource, and only the channel it was summoned in. Simpler
to reason about, and it refuses "summarise #leadership in #general" outright.
But it makes the bot a second access model to maintain (which channels is it
in, who adds it, what happens when it is removed), and it is *less* safe for
documents: a person outside a project could not read a document via the bot
that they could read directly, while a person inside could — the bot's answer
would depend on the bot's roster, not the asker's.

**Unrestricted reads — rejected.** The reply is posted where everyone in the
channel reads it. An unrestricted bot turns any public channel into a read path
for every private channel and every document in the workspace.

## Consequences

**A summoner can move private content into a public channel with one sentence.**
They could paste it themselves, so no new capability exists; but the bot lowers
the effort, and people will learn what it will and won't repeat. Reversing this
later means changing what the bot is trusted with, which is why it is recorded.

**Refusals are undifferentiated.** A read the summoner may not make returns
"not found, or no access", never "exists but denied": existence is information
too, and the reply is public.

**Every read tool is an internal query that takes a user id.** The writing
assistant, which does have an auth identity, resolves it first and passes it
through the same tools — one list, one rule, no identity-from-auth special case
inside a tool.
