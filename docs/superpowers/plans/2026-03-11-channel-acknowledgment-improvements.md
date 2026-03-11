# Channel Acknowledgment Improvements

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two channel acknowledgment bugs: eliminate the brief pill flash for the acting user, and auto-acknowledge on any visibility transition for the observing user.

**Architecture:** The `useAcknowledgedChannels` hook gains an `isVisible` parameter. The acting-user flash is fixed by checking `autoAckRef` inside the `displayList` memo (synchronous, not after-render). The observing-user issue is fixed by auto-acknowledging whenever the channel list transitions from not-visible to visible.

**Tech Stack:** React hooks, localStorage, useSyncExternalStore

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/hooks/use-acknowledged-channels.ts` | Modify | Add `isVisible` param, fix `displayList` memo, add visibility-transition auto-ack |
| `src/pages/App/Channel/ChannelSelectorList.tsx` | Modify | Compute `isVisible` from sidebar + section state, pass to hook |

---

## Chunk 1: Implementation

### Task 1: Fix acting-user pill flash in the hook

The `displayList` memo runs during render but `autoAckRef` is only consumed in a `useEffect` (after render), causing a one-frame flash of pills. Fix: check `autoAckRef.current` in the memo itself and short-circuit to the live list.

**Files:**
- Modify: `src/hooks/use-acknowledged-channels.ts:142-173`

- [ ] **Step 1: Add autoAckRef check to displayList memo**

In `src/hooks/use-acknowledged-channels.ts`, replace the `displayList` memo (lines 142-173) with a version that checks `autoAckRef.current` early:

```typescript
  const { displayList, newCount } = useMemo(() => {
    if (!channels)
      return { displayList: [] as { id: string; name: string; removed: boolean }[], newCount: 0 };

    // Acting user: autoAcknowledgeNext() was called, skip diff entirely
    if (autoAckRef.current) {
      return {
        displayList: channels.map((c) => ({ id: c.id, name: c.name, removed: false })),
        newCount: 0,
      };
    }

    // First load (no localStorage yet): show all as-is
    if (knownList.length === 0 && !rawSnapshot) {
      return {
        displayList: channels.map((c) => ({ id: c.id, name: c.name, removed: false })),
        newCount: 0,
      };
    }

    const liveMap = new Map(channels.map((c) => [c.id, c.name]));
    const display: { id: string; name: string; removed: boolean }[] = [];

    // Walk the known list in order — this preserves original positions
    for (const [id, name] of knownList) {
      if (liveMap.has(id)) {
        display.push({ id, name: liveMap.get(id)!, removed: false });
      } else {
        display.push({ id, name, removed: true });
      }
    }

    // Count new channels (live but not known)
    let fresh = 0;
    for (const c of channels) {
      if (!knownIdSet.has(c.id)) fresh++;
    }

    return { displayList: display, newCount: fresh };
  }, [channels, knownList, knownIdSet, rawSnapshot]);
```

Note: `autoAckRef` is a ref so it doesn't need to be in the dependency array — it's read by reference. The effect on lines 128-134 still runs after render to persist the ack to localStorage.

- [ ] **Step 2: Verify lint passes**

Run: `npm run lint`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add src/hooks/use-acknowledged-channels.ts
git commit -m "fix: eliminate acting-user pill flash by checking autoAckRef in displayList memo"
```

---

### Task 2: Add visibility-transition auto-acknowledge

When the channel list becomes visible (page load, reload, section expand, mobile sidebar open), auto-acknowledge everything. Pills should only appear for changes that happen while the list is actively visible.

**Files:**
- Modify: `src/hooks/use-acknowledged-channels.ts:64-67` (signature), add new effect
- Modify: `src/pages/App/Channel/ChannelSelectorList.tsx:1-8` (imports), `60-61` (hook call)

- [ ] **Step 1: Add `isVisible` parameter to the hook**

In `src/hooks/use-acknowledged-channels.ts`, change the function signature (line 64-66) to accept `isVisible`:

```typescript
export function useAcknowledgedChannels(
  workspaceId: string,
  channels: ChannelEntry[] | undefined,
  isVisible: boolean,
) {
```

- [ ] **Step 2: Add `prevVisibleRef` and replace the init effect**

Add `prevVisibleRef` right after the existing refs (after line 70):

```typescript
  const prevVisibleRef = useRef(false);
```

This ref is shared between the `displayList` memo (reads it to detect transition frames) and the visibility effect (updates it after render). It must be declared before both.

Replace the existing auto-initialize effect (lines 119-125):

```typescript
  // Auto-initialize: first time seeing this workspace, mark all current channels as known
  useEffect(() => {
    if (channels && initializedRef.current !== workspaceId && !rawSnapshot) {
      initializedRef.current = workspaceId;
      writeKnownList(workspaceId, liveList);
    }
  }, [channels, workspaceId, rawSnapshot, liveList]);
```

With a combined visibility-transition + first-load effect (place it AFTER the `displayList` memo so the ref declaration order is: ref → memo reads it → effect updates it):

```typescript
  // Auto-acknowledge on any not-visible → visible transition (page load, reload,
  // section expand, mobile sidebar open). Also handles first-load (no localStorage).
  // The point of acknowledgment is UI stability while the user is looking at the
  // list — if they weren't looking, there's no reference to diff against.
  useEffect(() => {
    const wasVisible = prevVisibleRef.current;
    prevVisibleRef.current = isVisible;

    if (!isVisible || !channels) return;

    // First load ever (no localStorage): seed the known list
    if (initializedRef.current !== workspaceId && !rawSnapshot) {
      initializedRef.current = workspaceId;
      writeKnownList(workspaceId, liveList);
      return;
    }

    // Transition from not-visible → visible: auto-acknowledge
    if (!wasVisible) {
      writeKnownList(workspaceId, liveList);
    }
  }, [isVisible, channels, workspaceId, rawSnapshot, liveList]);
```

- [ ] **Step 3: Update the displayList memo to suppress pills when not visible**

In the `displayList` memo, after the `autoAckRef.current` check added in Task 1, add a check for `!isVisible`:

```typescript
    // Acting user: autoAcknowledgeNext() was called, skip diff entirely
    if (autoAckRef.current) {
      return {
        displayList: channels.map((c) => ({ id: c.id, name: c.name, removed: false })),
        newCount: 0,
      };
    }

    // Not visible, or transitioning to visible right now: show live list, no pills.
    // The visibility-transition effect will persist the ack to localStorage after render.
    // Reading prevVisibleRef here (before the effect updates it) detects the transition frame.
    if (!isVisible || !prevVisibleRef.current) {
      return {
        displayList: channels.map((c) => ({ id: c.id, name: c.name, removed: false })),
        newCount: 0,
      };
    }
```

This prevents pills on the first render when transitioning to visible. The memo reads `prevVisibleRef.current` which is still `false` during the transition render (the effect updates it after render). This eliminates the one-frame pill flash on visibility transitions.

Also update the memo's dependency array to include `isVisible`:

```typescript
  }, [channels, knownList, knownIdSet, rawSnapshot, isVisible]);
```

- [ ] **Step 4: Compute `isVisible` in ChannelSelectorList and pass to hook**

In `src/pages/App/Channel/ChannelSelectorList.tsx`:

Add `useSidebar` to the imports from the sidebar component (line 21-28):

```typescript
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "../../../components/ui/sidebar";
```

Inside the component, after `const [showCreateChannel, setShowCreateChannel] = useState(false);` (line 47), add:

```typescript
  const { state: sidebarState, openMobile, isMobile } = useSidebar();
  const isChannelListVisible = isOpen && (isMobile ? openMobile : sidebarState === "expanded");
```

Note: `useSidebar()` already provides `isMobile`, so no separate `useIsMobile` import is needed.

Update the hook call (lines 60-61) to pass `isChannelListVisible`:

```typescript
  const { displayList, newCount, removedCount, acknowledgeAll, acknowledgeOne, autoAcknowledgeNext } =
    useAcknowledgedChannels(workspaceId, channelEntries, isChannelListVisible);
```

- [ ] **Step 5: Verify lint passes**

Run: `npm run lint`
Expected: No new errors

- [ ] **Step 6: Commit**

```bash
git add src/hooks/use-acknowledged-channels.ts src/pages/App/Channel/ChannelSelectorList.tsx
git commit -m "fix: auto-acknowledge channels on visibility transitions

Pills now only appear for changes that happen while the channel list
is actively visible. Page load, reload, section expand, and mobile
sidebar open all auto-acknowledge."
```

---

### Task 3: Remove unused `initializedRef` guard (cleanup)

After Task 2, the `initializedRef` is still used for the first-load case (no localStorage), but the `!rawSnapshot` check already handles idempotency. The `initializedRef` guard for workspace switching is still valid. No changes needed — the ref stays.

This is a no-op task; skip if no cleanup is warranted after reviewing the final code.

---

### Task 4: Manual verification

- [ ] **Step 1: Verify acting-user flow**

1. Start dev server: `npm run dev`
2. Open the app, go to a workspace
3. Create a new channel — verify NO pills flash momentarily
4. Delete a channel — verify NO pills flash momentarily

- [ ] **Step 2: Verify observing-user visibility transitions**

1. In another browser/incognito, have a second user create a channel
2. Reload the page as the first user — verify NO pills appear (auto-acknowledged)
3. Collapse the Channels section, have second user create another channel, expand section — verify NO pills
4. On mobile, close sidebar, have second user create a channel, reopen sidebar — verify NO pills

- [ ] **Step 3: Verify pills still work for real-time changes while visible**

1. Keep the Channels section open and visible
2. Have a second user create a channel — verify +1 pill appears
3. Have a second user delete a channel — verify ghost item + -1 pill appears
4. Click the Channels header — verify pills dismiss and list updates
