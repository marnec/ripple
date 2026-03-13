# Error Boundaries Design

## Problem

The app crashes at runtime when navigating to resources that don't exist (e.g., `/diagrams/<invalid-id>`). There is no top-level error boundary, no React Router `errorElement` usage, and null-check handling for missing resources is inconsistent across pages.

## Solution

A two-layer error boundary strategy plus a null-check audit across all resource pages.

## Layer 1: Top-Level React Error Boundary

A class-based `ErrorBoundary` component wrapping `RouterProvider` in `src/main.tsx`. This is the last-resort fallback for catastrophic errors (provider crashes, errors outside the router tree).

**File:** `src/components/ErrorBoundary.tsx`

- React class component implementing `componentDidCatch`
- Full-page fallback UI: centered "Something went wrong" message with a **Reload** button (`window.location.reload()`)
- Styled consistently with existing error pages (uses Tailwind classes, no shadcn dependencies since providers may be broken)

**Integration in `src/main.tsx`:**
```tsx
<ErrorBoundary>
  <ThemeProvider attribute="class">
    ...
    <RouterProvider router={router} />
    ...
  </ThemeProvider>
</ErrorBoundary>
```

## Layer 2: Route-Level Error Boundary via `errorElement`

A `RouteErrorFallback` component using React Router's `useRouteError()` to display errors **inside the layout** (sidebar remains visible and functional).

**File:** `src/components/RouteErrorFallback.tsx`

- Uses `useRouteError()` and `isRouteErrorResponse()` from react-router-dom
- Shows a centered error message with an icon, contextual message, and "Go back" / "Try again" buttons
- For 404s: "This page doesn't exist"
- For other errors: "Something went wrong"
- "Try again" calls `navigate(0)` to reload the current route

**Integration in `src/routes.tsx`:**
```tsx
{
  path: "/",
  element: <App />,
  errorElement: <RouteErrorFallback />,  // catches errors outside workspace layout
  children: [
    {
      path: "workspaces/:workspaceId",
      errorElement: <RouteErrorFallback />,  // catches resource-level errors, sidebar stays
      children: [...]
    }
  ]
}
```

The `workspaces/:workspaceId` level is key — errors in resource pages (channels, documents, diagrams, etc.) are caught here, preserving the sidebar and workspace navigation.

## Layer 3: Null Check Audit

Standardize the `undefined` = loading / `null` = deleted-or-no-access pattern across all resource pages.

### Convention

| Query result | Meaning | UI |
|---|---|---|
| `undefined` | Loading | Empty reserved space (existing pattern, no skeletons per UX principles) |
| `null` | Deleted / no access | `<ResourceDeleted resourceType="..." />` |

### Pages to Fix

**DiagramPage** (`src/pages/App/Diagram/DiagramPage.tsx`):
- Missing `null` check for `diagram` — currently falls through to render with `diagram?.name` etc.
- Returns `null` for missing route params — should return `<SomethingWentWrong />` (though route-level errorElement will also catch this)
- Fix: Add `if (diagram === null) return <ResourceDeleted resourceType="diagram" />;` after the loading check

**DocumentEditor** (`src/pages/App/Document/DocumentEditor.tsx`):
- The check `if (isLoading || !editor || !document)` lumps `null` (deleted) with `undefined` (loading), showing the loading state forever for deleted documents
- Fix: Add explicit `if (document === null) return <ResourceDeleted resourceType="document" />;` before the loading check

**DocumentEditorContainer** (`src/pages/App/Document/DocumentEditor.tsx`):
- Returns `<p className="p-20">No document selected</p>` for missing params — inconsistent styling
- Fix: Use `<SomethingWentWrong />` (though this case is unlikely given route structure)

**ProjectLayout** (`src/pages/App/Project/ProjectLayout.tsx`):
- Uses `<SomethingWentWrong />` when `project === null` — should use `<ResourceDeleted resourceType="project" />`

**TaskDetailPage** (`src/pages/App/Project/TaskDetailPage.tsx`):
- Uses `<SomethingWentWrong />` when `task === null` — should use a "task not found" message. Since `ResourceDeleted` doesn't have a "task" type, we add "task" to its type union.

**CycleDetail** (`src/pages/App/Project/CycleDetail.tsx`):
- Uses `<SomethingWentWrong />` when `cycle === null` — same fix, add "cycle" to `ResourceDeleted` types.

### ResourceDeleted Type Update

Extend the `resourceType` prop to include all resource types:

```typescript
type ResourceDeletedProps = {
  resourceType: "channel" | "document" | "diagram" | "spreadsheet" | "project" | "task" | "cycle";
};
```

## Existing SomethingWentWrong Component

The existing `src/pages/SomethingWentWrong.tsx` remains as-is. It's still used by `ChannelSettings` for the `currentUser === null` case and as a fallback for missing route params. The new `RouteErrorFallback` is separate since it needs `useRouteError()`.

## Files Changed

| File | Change |
|---|---|
| `src/components/ErrorBoundary.tsx` | **New** — class-based top-level error boundary |
| `src/components/RouteErrorFallback.tsx` | **New** — route-level error fallback using `useRouteError()` |
| `src/main.tsx` | Wrap tree with `<ErrorBoundary>` |
| `src/routes.tsx` | Add `errorElement` to root and workspace routes |
| `src/pages/ResourceDeleted.tsx` | Add "task" and "cycle" to resourceType union |
| `src/pages/App/Diagram/DiagramPage.tsx` | Add null check for diagram |
| `src/pages/App/Document/DocumentEditor.tsx` | Add explicit null check for document, fix container fallback |
| `src/pages/App/Project/ProjectLayout.tsx` | Switch from `SomethingWentWrong` to `ResourceDeleted` for null project |
| `src/pages/App/Project/TaskDetailPage.tsx` | Switch to `ResourceDeleted` for null task |
| `src/pages/App/Project/CycleDetail.tsx` | Switch to `ResourceDeleted` for null cycle |

## Out of Scope

- Convex mutation error handling (already uses toast notifications)
- Network/offline error handling (already handled by collaboration hooks)
- Convex query-level error boundaries (queries return null on failure by convention)
