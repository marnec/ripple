# Phase 13: Diagram Multiplayer Cursors - Context

**Gathered:** 2026-02-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Real-time cursor awareness and element sync for Excalidraw diagrams. Users see each other's pointers, name labels, and drawing actions in real-time. Existing diagrams remain compatible. Active users list shows who's viewing the diagram. User colors are consistent with Phase 12 document cursors (shared ColorHash singleton).

</domain>

<decisions>
## Implementation Decisions

### Pointer visualization
- Figma-style colored arrow cursor in the user's assigned color
- Always-visible name label next to the pointer (colored tag with display name)
- Natural stacking when pointers overlap — no auto-offset logic needed
- No off-screen indicators — pointers only visible when in the viewer's current viewport

### In-progress element sync
- Real-time preview when drawing new shapes — others see the shape forming as it's dragged
- Live movement when moving or resizing elements — others see the element sliding in real-time
- Lock-on-select for conflict prevention — selecting an element locks it for that user, others see a lock indicator
- Freehand drawing sync approach is Claude's discretion (stream vs show-on-complete)

### Active users display
- Same placement and component pattern as Phase 12's document avatar stack — consistency across features
- Same max avatar count before "+N" overflow as documents
- Colored ring on each avatar matching the user's cursor color — easy to map avatar to pointer on canvas
- Clicking a user's avatar pans the canvas to center on where that user is working (jump-to-user)

### Idle & stale behavior
- Pointer fades to transparent after a timeout period when user stops moving
- Stale user removal matches Phase 12's document timeout (10s) for consistency
- No re-entry animation — cursor simply resumes at full visibility when user moves again
- Claude has discretion on whether idle pointers show reduced opacity vs fully faded

### Claude's Discretion
- Freehand drawing sync strategy (stream live points vs show completed stroke)
- Idle pointer opacity treatment (semi-transparent vs full fade)
- Exact fade timeout duration for idle pointers
- Lock indicator visual design (how locked elements appear to other users)
- Pointer smoothing/interpolation for network latency

</decisions>

<specifics>
## Specific Ideas

- Figma is the reference for pointer visualization — colored arrow cursors with name labels
- Jump-to-user on avatar click is inspired by Figma's "follow user" behavior (but just a one-time pan, not continuous follow)
- Consistency with Phase 12 is a priority: same ColorHash colors, same avatar stack pattern, same stale timeouts

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 13-diagram-multiplayer-cursors*
*Context gathered: 2026-02-11*
