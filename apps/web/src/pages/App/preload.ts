// Centralized route-chunk preloaders.
//
// Each lazy route in `routes.tsx` ships its own JS chunk; some are
// expensive (BlockNote, Excalidraw, jsuites, @schedule-x, emoji-picker).
// Calling these functions early — typically on hover or on layout mount —
// kicks off the chunk download in parallel with whatever React is doing,
// so by the time the user actually clicks, the module is parsed.
//
// Vite/Rollup deduplicate dynamic imports by module identity, so calling
// any of these multiple times only triggers the network fetch once. The
// import specifiers below must stay in lock-step with `routes.tsx` —
// matching strings keep dev-mode HMR clear and make accidental drift
// easier to spot.
//
// Convention: each preload function targets the leaf route a user is
// most likely to land on for the given surface (e.g. clicking a Project
// in the sidebar navigates to `/projects/:id/tasks`, not the overview,
// so we warm both the layout and the tasks page).

import type { BrowsableResourceType } from "@ripple/shared/types/resources";

// ─── Dashboard ────────────────────────────────────────────────────────

export function preloadDashboardLayout() {
  return import("./Dashboard/DashboardLayout");
}

export function preloadMyTasksTab() {
  return import("./Dashboard/MyTasksTab");
}

export function preloadMyCalendarTab() {
  return import("./Dashboard/MyCalendarTab");
}

// ─── Documents ────────────────────────────────────────────────────────
// Pulls BlockNote — one of the biggest editor chunks in the app.

export function preloadDocumentEditor() {
  return import("./Document/DocumentEditor");
}

// ─── Diagrams ─────────────────────────────────────────────────────────
// Pulls Excalidraw + Mermaid — multiple large chunks.

export function preloadDiagramPage() {
  return import("./Diagram/DiagramPage");
}

// ─── Spreadsheets ─────────────────────────────────────────────────────
// Pulls jsuites (~520 KB) — the biggest single editor dep.

export function preloadSpreadsheetPage() {
  return import("./Spreadsheet/SpreadsheetPage");
}

// ─── Channels / Chat ──────────────────────────────────────────────────
// Pulls the chat container with emoji-picker-react and the message
// rendering pipeline. Clicking any channel item lands here.

export function preloadChatContainer() {
  return import("./Chat/ChatContainer");
}

// ─── Projects ─────────────────────────────────────────────────────────
// Clicking a project in the sidebar navigates to `/projects/:id/tasks`,
// so the realistic landing is layout + tasks page (kanban).

export function preloadProjectLayout() {
  return import("./Project/ProjectLayout");
}

export function preloadProjectTasksPage() {
  return import("./Project/ProjectTasksPage");
}

// ─── Resource-type dispatch ───────────────────────────────────────────
// Resource list pages (Documents/Diagrams/...) render heterogeneous
// rows via a shared component, so we look the right preloader up by
// type rather than threading a callback through every prop.

const RESOURCE_PRELOADERS: Record<BrowsableResourceType, () => Promise<unknown>> = {
  document: preloadDocumentEditor,
  diagram: preloadDiagramPage,
  spreadsheet: preloadSpreadsheetPage,
  channel: preloadChatContainer,
  project: () => Promise.all([preloadProjectLayout(), preloadProjectTasksPage()]),
};

export function getResourcePreloader(
  resourceType: BrowsableResourceType,
): () => Promise<unknown> {
  return RESOURCE_PRELOADERS[resourceType];
}
