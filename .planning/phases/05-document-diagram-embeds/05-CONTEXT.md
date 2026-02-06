# Phase 5: Document & Diagram Embeds - Context

**Gathered:** 2026-02-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can embed Excalidraw diagrams and link Ripple documents in task descriptions with inline previews. Users can @mention other users in task descriptions. Users can reference projects from any channel or task description. A unified `#` autocomplete triggers all reference types (docs, diagrams, projects). Project references also work in chat messages.

</domain>

<decisions>
## Implementation Decisions

### Embed appearance
- Diagrams: Reuse existing `DiagramBlock.tsx` component — same look as in documents
- Diagrams are **read-only** in task descriptions; click opens full Excalidraw editor on the diagram page
- Documents: Simple styled link with document icon and title — click navigates to document
- Deleted references: Show greyed-out "deleted" label (consistent with document editor behavior)

### Linking behavior
- `#` character triggers autocomplete (same pattern as existing document editors)
- Combined picker shows documents, diagrams, AND projects differentiated by icon
- Picker scope: All docs/diagrams/projects the user has access to in the workspace (docs and diagrams are workspace-level, not project-scoped)
- No paste-to-embed — pasted URLs stay as plain links, only `#` insertion creates embeds/links

### @mention behavior
- `@` triggers autocomplete scoped to project members (people who can see the task)
- Display: Bold clickable text (no background chip) — clean and unobtrusive
- Click action: None (display only, no navigation or popover)
- Removed members: @mention greys out to indicate they're no longer a project member

### Cross-project references
- Display: Inline colored chip with project color dot and name
- Click navigates to the project page
- Available in both task descriptions (BlockNote) and chat messages (MessageComposer)
- Inserted via the same `#` autocomplete picker (combined with docs/diagrams)
- Inaccessible projects: Grey chip, no link — consistent with @mention removed-member pattern

### Claude's Discretion
- BlockNote custom block/inline content implementation details
- Autocomplete dropdown styling and keyboard navigation
- How to adapt DiagramBlock for read-only mode in task context
- Search/filter behavior within the `#` picker

</decisions>

<specifics>
## Specific Ideas

- "It should appear exactly like in documents" — reuse DiagramBlock.tsx for diagram embeds
- "As in documents, by using the # character" — consistent insertion pattern across the app
- Consistent degradation pattern: deleted refs show label, removed users grey out, inaccessible projects grey out

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 05-document-diagram-embeds*
*Context gathered: 2026-02-06*
