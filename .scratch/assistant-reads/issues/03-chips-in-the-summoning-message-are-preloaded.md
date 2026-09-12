# 03 — Chips in the summoning message are preloaded (referenced context)

**Parent:** `.scratch/assistant-reads/spec.md`

**What to build:** "@Assistant summarise #Roadmap" answers from the chipped document without a search. Before the model runs, the chat reply loads the content of the **reference chips** in the summoning message: documents, tasks and projects, up to five chips, each clipped at the chat limit, read through the identity-taking reads as the **summoner**. Chips whose type is not readable yet (diagram, spreadsheet, event) are rendered as "referenced, not readable" so the model says so instead of guessing. User mentions are skipped. Chips in earlier messages are not preloaded. The instructions say that **referenced context** is not cited: no Sources line when the only content came from the summoner's own chips.

**Blocked by:** 02 — Chat assistant reads through tools.

**Status:** done

- [x] A chipped document's text appears in the first model prompt and the reply has no Sources line
- [x] A chipped task's fields and description appear in the first prompt
- [x] A sixth chip is not preloaded; the model can still reach it by id through a tool
- [x] A chipped diagram renders as referenced but not readable and the reply says so
- [x] A chip to a deleted resource renders as not accessible without failing the reply
- [x] A chip the summoner cannot access renders as not accessible, indistinguishable from deleted
- [x] A chip in an earlier message is not preloaded
- [x] Preload rendering and clipping are pure functions with unit tests; the end-to-end cases run through the chat send seam
