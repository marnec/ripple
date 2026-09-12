## Problem Statement

When someone mentions the workspace assistant in a channel, it can only see that channel's recent messages. Ask it to summarise a document, check on a project, or say what a task is about, and it has to answer "I can't see that". People then paste the content into the channel by hand, which defeats the point of having the assistant inside the workspace where the content already lives.

## Solution

The workspace assistant reads the workspace on the summoner's behalf. Two paths feed it content:

- **Referenced context**: reference chips in the summoning message ("@Assistant summarise #Roadmap") are loaded before the model runs. The summoner said "this one", so no search is needed.
- **Fetched context**: for anything not chipped, the assistant has a read-only set of **assistant tools**: find resources by name, read a document, a task, a project, or a channel's recent messages. When it used a tool, the reply ends with a "Sources" line naming what it read.

Every read is made with the summoner's access. The assistant can reach exactly what the person who mentioned it could have pasted, and nothing more (ADR 0003). The in-editor writing assistant already has read tools of its own; after this change both surfaces share one tool set, so what one can read the other can too.

## User Stories

1. As a workspace member, I want to chip a document in a message that mentions the assistant and have it answer about that document, so that I can ask "summarise this" without pasting.
2. As a workspace member, I want to chip a task and ask the assistant about it, so that I can get its status, assignee, dates and description in one reply.
3. As a workspace member, I want to chip a project and ask how it is going, so that I get a reply grounded in the project's actual tasks.
4. As a workspace member, I want to chip several resources in one message and ask a question spanning them, so that the assistant can compare or combine them.
5. As a workspace member, I want the assistant to find a document by name when I ask about it without a chip, so that I do not have to look it up first.
6. As a workspace member, I want the assistant to read another channel's recent messages when I ask what was discussed there, so that I can catch up without switching channels.
7. As a workspace member, I want the assistant to read tasks and projects it finds by name, so that "how is the billing project going" works without a chip.
8. As a workspace member, I want the reply to name the resources the assistant read on its own, so that I can check the source before trusting a summary.
9. As a workspace member, I do not want a "Sources" line when the only content came from the chip in my own message, so that replies stay short.
10. As a workspace member, I want the assistant to say plainly when it cannot find or access something, so that I know to chip it or ask a colleague instead of getting a guess.
11. As a workspace member, I want the assistant to say that a chipped diagram, spreadsheet or event is referenced but not readable yet, so that it never invents a summary of something it did not see.
12. As a workspace member, I want the assistant to read from a document that was edited moments ago and get everything but the last few seconds, so that summaries are current enough for chat.
13. As a workspace member, I want a document that nobody has written in to read as empty, so that the assistant says "it's empty" rather than "I can't read it".
14. As a workspace member, I want the assistant to answer in the language I used, referencing resources by their current names, so that a renamed document reads correctly.
15. As a member of a private channel, I want the assistant to refuse to read that channel when summoned by someone who is not in it, so that a private channel's content cannot be pulled into a public one through the bot.
16. As a member of a private channel, I want the assistant to be able to summarise it for me when I ask from that same channel, so that the bot is useful inside private channels too.
17. As a workspace admin, I want the assistant to be unable to read anything from another workspace, even when given an id, so that workspace isolation holds for the bot as it does for people.
18. As a workspace admin, I want reads to be part of the existing assistant feature rather than a second toggle, so that enabling the assistant means enabling a useful assistant.
19. As a workspace admin, I want the reply rate limit to stay per reply regardless of how many reads a reply makes, so that the cost bound I already understand still holds.
20. As a workspace admin, I want every model round trip a reply makes to appear in the usage records, so that I can see what reading costs.
21. As a workspace admin, I want a reply that would need more than a handful of reads to stop and answer with what it has, so that one question cannot run up an unbounded bill.
22. As a workspace member, I want a very long document to be clipped rather than rejected, so that the assistant still answers about the part it could read and says it was truncated.
23. As a workspace member, I want the assistant not to distinguish "no access" from "does not exist", so that the existence of resources I cannot see is not revealed in a public channel.
24. As a workspace member, I want a task read to include its title, number, status, priority, assignee, due date, tags and description, so that the reply reflects the whole task.
25. As a workspace member, I want a project read to include its fields and a capped list of its tasks with open ones first, so that "what's left on X" can be answered.
26. As a workspace member, I want chips that appeared earlier in the conversation, not just in my message, to be reachable by the assistant, so that "is that realistic?" three messages after someone chipped the roadmap works.
27. As a workspace member using the in-editor writing assistant, I want it to keep every read tool it has today and gain the project read, so that the two assistants never diverge in what they can see.
28. As a workspace member using the in-editor writing assistant, I want its reads to be bound to my own access exactly as before, so that sharing one tool set with chat changes nothing about what it may read.
29. As a developer, I want one place where every assistant read is defined, so that adding a resource type to one assistant adds it to both and applies the right access rule by construction.
30. As a developer, I want a test that fails when a tool reads through anything other than that one place, so that a second, unguarded read path cannot be added by accident.
31. As a developer, I want the summoner's identity to travel with the reply job as data, so that a scheduled action with no auth identity still applies the summoner's access.
32. As a workspace member, I want a chip to a deleted resource to read as not accessible, so that the assistant does not error out on a stale reference.
33. As a workspace member, I want the assistant's own previous replies to remain part of its memory of the channel, so that follow-up questions about a document it already read do not require re-chipping.
34. As a workspace member, I want the assistant to stay quiet as before when the feature is off or the rate limit is spent, so that adding reads changes nothing about when it answers.

## Implementation Decisions

**Vocabulary.** The glossary now defines **workspace assistant**, **summoner**, **assistant tools**, and **referenced context** versus **fetched context**. ADR 0003 records that reads act as the summoner.

**One tool factory, two surfaces.** The read tools the writing assistant currently defines inline move into a shared factory in the backend's library layer. The factory takes a workspace id and a summoner user id and returns the tool set. The chat reply action passes the summoner it already carries; the writing assistant's HTTP action resolves the user from auth first and passes that. There is no identity-from-auth logic inside any tool.

**Identity-taking reads.** The tools call public queries today, which resolve the caller from auth. A scheduled action has none. A new backend module holds one internal query per read, each taking the summoner's user id and delegating to the same access helper its public twin uses: the workspace rule for documents, tasks and projects, the channel rule for messages, and the shared collaboration-access check for snapshot URLs. The public queries are unchanged. This module is the only read path the tools may use.

**Tool set.** Five tools: find resources by name (documents, tasks, channels, projects, diagrams, spreadsheets, returning ids), read document, read task, read project, read channel messages. Read project is new to both surfaces and returns the project's fields plus up to 50 of its tasks with title and status, open tasks first. Read task returns fields plus description, no comments. Read channel messages returns the most recent messages oldest first, default 30, maximum 100.

**Refusal contract.** Every tool returns one undifferentiated "not found, or you do not have access to it" for a missing, deleted, foreign-workspace, or access-denied resource. Nothing distinguishes the cases.

**Content source.** Document and task bodies are read from the stored cold-start snapshot, rendered to text by the existing snapshot-to-text renderer. A resource with no snapshot reads as empty. No live-room read.

**Referenced context.** Before the model runs, the chat reply loads the content of the reference chips in the summoning message: documents, tasks and projects, up to five chips, each clipped. Chips whose type is not readable in this slice (diagram, spreadsheet, event) are rendered as "referenced, not readable". User mentions are not resources and are skipped. Chips in earlier messages are not preloaded.

**Transcript renders ids.** Where a chip flattens to a name today, the model's transcript renders it as the name followed by the resource type and id, inline, so the model can pass the id to a tool. This is the model's view only; the stored plain text and what people see are unchanged.

**Prompt.** The instruction "you can only see this channel's messages" is replaced by a description of the tools, the summoner-access boundary, the instruction to say when something cannot be found or read, and the "Sources" rule: end the reply with a "Sources" line naming resources read through tools, and omit it when nothing was fetched.

**Budgets.** Chat: six steps per reply, 30,000 characters per read, five preloaded chips. Writing assistant keeps its eight steps and 60,000 characters. Both as named constants; the factory takes the per-read clip as a parameter. Output token limit and the per-workspace reply rate limit are unchanged.

**Entitlement.** Reads are part of the existing assistant feature. No new feature key.

**Usage.** The existing usage handler already records one row per model step; multi-step replies produce multiple rows. No change.

## Testing Decisions

A good test drives the feature from where a person would and asserts on what a person would see: a message that mentions the assistant goes in, a reply comes out, and the model's recorded prompts show what it was given. Tests do not call tools directly or inspect the factory.

**Primary seam: the chat send path with a scripted model.** The existing chat assistant tests mention the bot through the public send mutation, install a mock language model in place of the provider, drain the pools, and read the posted reply. That seam is reused. The mock is scripted to call a tool on its first step and answer on its second, so the tests observe both the tool wiring and what the tool returned, via the prompt of the second model call. Cases:

- A chipped document's text appears in the first prompt (referenced context), and no "Sources" is required.
- A chipped diagram renders as referenced but not readable.
- A chip in an earlier message is not preloaded but its id appears in the transcript.
- A tool read of a document the summoner can access returns its text; the reply is posted.
- A tool read of a private channel the summoner is not in returns the refusal string, and the reply is still posted.
- A tool read of a document from another workspace returns the refusal string.
- A tool read of a task returns the expected fields; a project read lists its tasks open-first and capped.
- A document with no snapshot reads as empty.
- A read over the clip limit is truncated with the marker.
- A reply hitting the step limit still posts.
- Feature off and rate limit spent still produce no reply.

Prior art: the chat assistant test file and the access test files for messages, snapshots and cross-workspace reads.

**Second seam: pure helpers.** Transcript rendering with chip ids, chip preload rendering, and the clip are pure functions and are unit-tested as the document assistant helpers are today.

**Third seam: source-scan guard.** A test in the style of the trigger write guard reads the tool factory's source and asserts that every read it performs goes through the identity-taking reads module, and that no tool imports a public query.

**Writing assistant.** Its HTTP access tests stay as they are. The shared factory is covered through the chat seam; one test asserts the writing assistant still reaches the model for a member, as today.

## Out of Scope

- Spreadsheet and diagram content (slice two for spreadsheets: a markdown table of computed values, 200-row cap).
- Calendar events and series as readable resources.
- Task comments in a task read.
- Content search. Search remains name-only; indexing snapshot text or embeddings is a separate project.
- Live-room reads. The stored snapshot is the source.
- Reference chips or links in the reply. The "Sources" line is plain text.
- Any change to the writing assistant's editing tools, step limits, or prompt.
- Any change to who the assistant answers, when, or how often.
- A second entitlement.

## Further Notes

The reply is public to the channel. The summoner-access rule means a person can move private content into a public channel with one sentence, but they could paste it themselves, so no new capability exists. ADR 0003 records this so it is not "fixed" later by giving the bot an identity of its own.

Stored snapshots lag the live room by the save debounce, up to ten seconds. The glossary's snapshot embed deliberately avoids this lag; for chat replies it is accepted.

The writing assistant's tools currently call public queries. Moving them to identity-taking internal queries is a refactor with no behaviour change for that surface; the access tests pin that.
