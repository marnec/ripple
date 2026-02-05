# Phase 1: Projects Foundation - Context

**Gathered:** 2026-02-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Project containers with membership-based access control. Users can create and manage projects as containers for tasks. Projects automatically create a dedicated channel that inherits membership. This phase establishes the foundation — tasks themselves come in Phase 2.

</domain>

<decisions>
## Implementation Decisions

### Project creation flow
- Create action lives in sidebar (consistent with channels/documents)
- Name only required at creation — minimal friction
- User lands inside the new project after creation (like channels)
- Only workspace admins can create projects
- No templates or presets — always start blank
- Color picker available for visual distinction (no icon)
- Instant creation, no confirmation step (like channels)

### Project visibility & listing
- Dedicated "Projects" section in sidebar (separate from Channels)
- Section is collapsible
- Each project shows: name + color dot
- Sorted alphabetically by name

### Membership management
- Creator only gets access initially — others added manually
- Members managed via project settings page
- No project-specific roles for v1 — just membership (access or no access)
- Members cannot remove themselves; only admins can remove members

### Claude's Discretion
- Description editing location (settings vs inline)
- Empty state design for project view
- Exact color palette options
- Member list UI layout

</decisions>

<specifics>
## Specific Ideas

- "Like channels" — user expects consistent patterns with existing channel creation and navigation
- Sidebar behavior should match existing collapsible sections

</specifics>

<deferred>
## Deferred Ideas

- Project-specific roles (admin/editor/viewer tiers) — defer to later implementation
- Project templates/presets — explicitly not wanted for v1

</deferred>

---

*Phase: 01-projects-foundation*
*Context gathered: 2026-02-05*
