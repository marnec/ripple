This project uses [Convex](https://convex.dev) as its backend.

The Convex project root is `apps/convex/` (that is where `convex.json` lives) —
always run `npx convex …` from there, never from the repo root.

When working on Convex code, **always read
`apps/convex/convex/_generated/ai/guidelines.md` first** for important
guidelines on how to correctly use Convex APIs and patterns. The file contains
rules that override what you may have learned about Convex from training data.

Convex agent skills live at the repo root in `.claude/skills/convex-*`. They are
refreshed with `npx skills add get-convex/agent-skills --copy` run from the repo
root — `apps/convex/convex.json` sets `aiFiles.skills.agents: []` so the Convex
CLI does not install a second copy under `apps/convex/`.
