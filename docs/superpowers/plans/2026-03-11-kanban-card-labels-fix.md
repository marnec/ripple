# Kanban Card Labels Fix — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix label row height reservation to prevent layout shift between cards with/without labels, and add a "+N" overflow indicator with tooltip when labels exceed available horizontal space.

**Architecture:** Modify `KanbanCardPresenter` to use a single-row non-wrapping label container with a ref-based overflow detection hook. When labels overflow, show a "+N" badge that reveals all labels in a tooltip on hover. Reserve stable height via a min-height that matches the actual Badge rendered height.

**Tech Stack:** React (ref + useLayoutEffect + ResizeObserver), shadcn Tooltip (already app-wide via TooltipProvider), existing Badge component.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/pages/App/Project/KanbanCardPresenter.tsx` | Modify | Update labels section: stable height, overflow detection, "+N" tooltip |

No new files needed. Single-file change.

---

## Chunk 1: Label Height & Overflow Indicator

### Task 1: Fix label row height reservation and add overflow indicator

**Files:**
- Modify: `src/pages/App/Project/KanbanCardPresenter.tsx:88-99`

**Current problem:**
- Labels row uses `max-h-5` (20px) and `flex-wrap` — when badges are taller than 20px or there are no labels, height is inconsistent
- Empty state uses an invisible `<span>` with `text-xs py-0` which doesn't match actual Badge height (badges have border + padding)
- Horizontal overflow is silently clipped with no indicator

**Solution:**
1. Change labels container from `flex-wrap overflow-hidden max-h-5` to `flex-nowrap overflow-hidden` with a fixed `min-h-[22px]` (matching Badge rendered height: text-xs line-height 16px + 2px border = ~20-22px)
2. Add a `useLabelsOverflow` inline hook using a ref + ResizeObserver to detect when labels overflow
3. When overflow detected, render a `+N` Badge at the end that shows all labels in a Tooltip on hover

- [ ] **Step 1: Add imports for Tooltip and hooks**

At the top of `KanbanCardPresenter.tsx`, add:

```tsx
import { useRef, useState, useLayoutEffect } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { MoreHorizontal } from "lucide-react";
```

- [ ] **Step 2: Create overflow detection hook inside the component**

Before the return statement in `KanbanCardPresenter`, add:

```tsx
// Overflow detection for labels row
const labelsRef = useRef<HTMLDivElement>(null);
const [overflowCount, setOverflowCount] = useState(0);

useLayoutEffect(() => {
  const el = labelsRef.current;
  if (!el || !task.labels || task.labels.length === 0) {
    setOverflowCount(0);
    return;
  }

  const measure = () => {
    const children = Array.from(el.children) as HTMLElement[];
    // Last child might be the overflow indicator — skip it
    const labelChildren = children.filter(
      (c) => !c.dataset.overflowIndicator
    );
    let hidden = 0;
    const containerRight = el.getBoundingClientRect().right;
    for (const child of labelChildren) {
      if (child.getBoundingClientRect().right > containerRight + 1) {
        hidden++;
      }
    }
    setOverflowCount(hidden);
  };

  measure();

  const ro = new ResizeObserver(measure);
  ro.observe(el);
  return () => ro.disconnect();
}, [task.labels]);
```

- [ ] **Step 3: Replace the labels section JSX**

Replace lines 88-99 (the labels `<div>` block) with:

```tsx
{/* Labels — fixed height, single row with overflow indicator */}
<div
  ref={labelsRef}
  className="flex items-center gap-1 overflow-hidden min-h-[22px]"
>
  {task.labels && task.labels.length > 0 ? (
    <>
      {task.labels.map((label, index) => (
        <Badge
          key={index}
          variant="secondary"
          className="text-xs py-0 shrink-0"
        >
          {label}
        </Badge>
      ))}
      {overflowCount > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              data-overflow-indicator=""
              className="shrink-0 cursor-default"
            >
              <Badge variant="secondary" className="text-xs py-0">
                <MoreHorizontal className="h-3 w-3" />
              </Badge>
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-64">
            <div className="flex flex-wrap gap-1">
              {task.labels.map((label, index) => (
                <Badge
                  key={index}
                  variant="secondary"
                  className="text-xs py-0"
                >
                  {label}
                </Badge>
              ))}
            </div>
          </TooltipContent>
        </Tooltip>
      )}
    </>
  ) : (
    <span className="invisible text-xs leading-[22px]" aria-hidden>
      &#8203;
    </span>
  )}
</div>
```

**Key details:**
- `shrink-0` on each Badge prevents them from compressing — they either fit or they don't
- `min-h-[22px]` ensures consistent row height whether labels exist or not
- The empty-state placeholder uses `leading-[22px]` to match
- The overflow indicator `MoreHorizontal` icon is small and unobtrusive
- The tooltip shows ALL labels (including visible ones) for full context
- `data-overflow-indicator` attribute lets the measure function skip the indicator element
- ResizeObserver re-measures on container resize (e.g., column width changes)

- [ ] **Step 4: Run lint to verify**

Run: `npm run lint`
Expected: No errors related to our changes

- [ ] **Step 5: Visual verification**

Run: `npm run dev`

Check:
1. Cards with no labels have same height as cards with labels
2. Cards with 1-2 short labels show them all, no overflow indicator
3. Cards with many/long labels show a `⋯` badge at the end
4. Hovering the `⋯` badge shows a tooltip with all labels
5. Drag-and-drop still works (placeholder height matches)

- [ ] **Step 6: Commit**

```bash
git add src/pages/App/Project/KanbanCardPresenter.tsx
git commit -m "fix: stabilize kanban card label row height and add overflow indicator"
```
