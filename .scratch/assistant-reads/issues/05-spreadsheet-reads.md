# 05 — Spreadsheet reads

**Parent:** `.scratch/assistant-reads/spec.md`

**What to build:** A spreadsheet, chipped or found by name, reads as a markdown table of its computed values, formulas hidden, capped at 200 rows with a note when truncated. A new renderer turns the spreadsheet's stored snapshot (its cell data and stored formula values, in row and column order) into that table. A read-spreadsheet tool joins the shared **assistant tools** on both surfaces, and a spreadsheet chip in the summoning message becomes **referenced context** instead of "referenced, not readable".

**Blocked by:** 03 — Chips in the summoning message are preloaded.

**Status:** done

- [x] The renderer is a pure function with unit tests: values not formulas, row and column order respected, 200-row cap with a truncation note, empty snapshot renders as empty
- [x] A tool read of a spreadsheet returns the table; a foreign-workspace or inaccessible spreadsheet returns the refusal string
- [x] A chipped spreadsheet is preloaded and the reply answers from its values
- [x] Diagram and event chips still render as referenced but not readable
- [x] Tested through the chat send seam with the scripted mock model
