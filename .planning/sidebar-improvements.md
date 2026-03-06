# Sidebar Improvements Plan

Research-based proposals for improving Ripple's sidebar navigation, informed by patterns from Notion, Linear, Slack, Figma, and modern SaaS best practices.

## Current State

- shadcn/ui sidebar with icon-only collapse mode (Cmd+B toggle)
- Cookie-persisted expand/collapse state, mobile sheet drawer
- Structure: Workspace Switcher > Channels > Favorites (Projects, Documents, Diagrams, Spreadsheets) > User Menu
- Favorites system: max 3 pinned items per resource type
- "My Tasks" top-level item exists but is commented out

## Proposed Changes

### P0 — High Impact

#### 1. Quick Switcher / Command Palette (Cmd+K)

Universal pattern across Notion, Linear, Slack, Figma, and VS Code. A search-driven overlay that lets users jump to any channel, document, project, or diagram by typing a few characters. Eliminates the need to visually scan the sidebar. Single highest-impact navigation improvement.

#### 2. Unread Badges on Channels

Table stakes for any app with messaging. Bold channel names with unread messages and show a count badge. Transforms the sidebar from passive navigation into active awareness. The `SidebarMenuBadge` component already exists in our UI library.

#### 3. Recents Section

Notion elevated Recents to a first-class sidebar section. Users bounce between 5-10 items across types — a "Recents" section (last 5-8 items, mixed types) above the favorites reduces navigation friction significantly.

### P1 — Medium Impact

#### 4. Collapsible Sections with Persistent State

Notion, Slack, and Linear all allow independent section collapsing with remembered state. Users who primarily use documents shouldn't scroll past channels every time. Each section should collapse independently with state persisted via cookie or user settings.

#### 5. Re-enable "My Tasks"

Already implemented but commented out in `AppSidebar.tsx:120-133`. Every project management tool (Linear, Asana, Notion) puts personal tasks at the very top as the daily entry point. Uncomment and position as the first sidebar item.

#### 6. Inline Create Actions per Section

A `+` button on each section header (Channels, Documents, etc.) to create new items without navigating away. Follows Notion and Linear's pattern of reducing clicks to reach value.

### P2 — Polish

#### 7. Active Item Accent Styling

Strengthen the visual distinction for the active item. Consider a 2-3px colored left border accent (Linear's pattern) rather than just a background change.

#### 8. Drag-and-Drop Section Reordering

Let users reorder sidebar sections to match their workflow. A documents-heavy user might want Documents above Channels. Implementable with `@dnd-kit`. Higher effort, lower priority.

## Implementation Order

| Order | Change                    | Effort | Impact    |
|-------|---------------------------|--------|-----------|
| 1     | Quick Switcher (Cmd+K)    | Medium | Very High |
| 2     | Unread badges on channels | Medium | High      |
| 3     | Recents section           | Medium | High      |
| 4     | Collapsible sections      | Low    | Medium    |
| 5     | Re-enable My Tasks        | Very Low | Medium  |
| 6     | Inline create (+) buttons | Low    | Medium    |
| 7     | Active item accent        | Very Low | Low     |
| 8     | Drag-and-drop reorder     | High   | Low       |

## Sources

- [Sidebar Design for Web Apps: UX Best Practices (2026)](https://www.alfdesigngroup.com/post/improve-your-sidebar-design-for-web-apps)
- [Best UX Practices for Sidebar Menu Design in 2025](https://uiuxdesigntrends.com/best-ux-practices-for-sidebar-menu-in-2025/)
- [Best UX Practices for Designing a Sidebar — UX Planet](https://uxplanet.org/best-ux-practices-for-designing-a-sidebar-9174ee0ecaa2)
- [8+ Best Sidebar Menu Design Examples of 2025](https://www.navbar.gallery/blog/best-side-bar-navigation-menu-design-examples)
- [Navigate with the sidebar — Notion Help Center](https://www.notion.com/help/navigate-with-the-sidebar)
- [Mastering navigation sidebars in product design — Medium](https://medium.com/design-bootcamp/mastering-navigation-sidebars-in-product-design-1248f140f4b2)
- [Anatomy of an Effective SaaS Navigation Menu Design](https://lollypop.design/blog/2025/december/saas-navigation-menu-design/)
