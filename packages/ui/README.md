# @ripple/ui

The shadcn primitives shared by `apps/web` and `apps/admin`. Raw `.tsx` consumed
straight from source — there is no build step, so the React Compiler and Vite's
HMR treat these files exactly like app code.

```
import { Button } from "@ripple/ui/components/button";
import { cn } from "@ripple/ui/lib/utils";
```

## The one rule: no colours live here

This package owns **component shape** — layout, sizing, variants, states. It owns
**no theme values**. Components reference tokens (`bg-primary`, `border-border`,
`ring-foreground/10`); each app's `src/index.css` decides what those tokens mean.

That split is deliberate and load-bearing. `apps/admin` is a dark-only
amber-on-stone operator console; `apps/web` is a light/dark product. They share
every primitive and still look nothing alike, because the only thing crossing the
boundary is a token *name*. Putting a colour in this package would collapse that.

Corollary: a component here may only use tokens both apps define. Check
`apps/*/src/index.css` before reaching for a new one.

## Adding a component

Run the CLI from either app — their `components.json` points `ui` at this
package, so the file lands here and both apps get it:

```bash
cd apps/web && pnpm dlx shadcn@latest add popover
```

`components.json` here has an empty `tailwind.css`, since the package owns no
stylesheet. If a generated component needs a token neither app defines, add the
token to **both** apps' `index.css` — with each app's own value — rather than
introducing a stylesheet here.

Two things must hold for a new component to render:

- Both apps already `@source "../../../packages/ui/src"` in their `index.css`.
  Tailwind v4 does not scan `node_modules`, so without it none of the utility
  classes used only by this package are ever generated.
- Anything imported must be a dependency of *this* package, not of the app.

## Local patches

These files are generated output and are meant to be regenerable. Where a
component deviates from stock `base-nova`, the deviation carries an inline
`LOCAL PATCH` comment saying what and why — `button.tsx` (cursor + base-ui
`nativeButton`) and `tabs.tsx` (borderless active tab) currently have them.
Keep that convention: an undocumented edit here is silently lost the next time
someone runs `shadcn add`.

## What stays in the apps

Only genuinely shared primitives belong here. App-specific compositions —
`responsive-dialog`, `sidebar`, `safe-html`, admin's `console` — stay in their
app's `src/components/ui/`. A primitive earns its way in when the second app
needs it, not before.
