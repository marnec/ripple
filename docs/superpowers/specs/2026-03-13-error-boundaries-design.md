# Error Boundaries Design

## Problem

The app crashes at runtime when navigating to resources that don't exist (e.g., `/diagrams/<invalid-id>`). There is no top-level error boundary, no React Router `errorElement` usage, and null-check handling for missing resources is inconsistent across pages.

## Solution

A two-layer error boundary strategy plus a null-check audit across all resource pages.

## Layer 1: Top-Level React Error Boundary

A class-based `ErrorBoundary` component wrapping all providers (except `StrictMode`) in `src/main.tsx`. This is the last-resort fallback for catastrophic errors (provider crashes, errors outside the router tree).

**File:** `src/components/ErrorBoundary.tsx`

- React class component implementing `componentDidCatch`
- Full-page fallback UI: centered "Something went wrong" message with a **Reload** button (`window.location.reload()`)
- Styled with plain Tailwind classes only — no shadcn, no theme provider dependencies (since providers may be broken at this level)

**Integration in `src/main.tsx`:**
```tsx
<React.StrictMode>
  <ErrorBoundary>
    <ThemeProvider attribute="class">
      <PwaUpdateProvider>
        <Toaster />
        <ConvexAuthProvider client={convex}>
          <RouterProvider router={router} />
        </ConvexAuthProvider>
      </PwaUpdateProvider>
    </ThemeProvider>
  </ErrorBoundary>
</React.StrictMode>
```

## Layer 2: Route-Level Error Boundary via `errorElement`

A `RouteErrorFallback` component using React Router's `useRouteError()` to display errors **inside the layout** (sidebar remains visible and functional).

**File:** `src/components/RouteErrorFallback.tsx`

- Uses `useRouteError()` and `isRouteErrorResponse()` from react-router-dom
- Shows a centered error message with an icon, contextual message, and "Go back" / "Try again" buttons
- For 404s: "This page doesn't exist"
- For other errors: "Something went wrong"
- "Try again" calls `navigate(0)` to reload the current route
- Styled with plain Tailwind only (no shadcn) since the root-level placement renders without theme/auth providers

**Integration in `src/routes.tsx`:**
```tsx
{
  path: "/",
  element: <App />,
  errorElement: <RouteErrorFallback />,  // bare fallback, no sidebar/providers
  children: [
    {
      path: "workspaces/:workspaceId",
      errorElement: <RouteErrorFallback />,  // renders inside Layout's <Outlet />, sidebar preserved
      children: [...]
    }
  ]
}
```

The `workspaces/:workspaceId` placement is key — errors in resource pages (channels, documents, diagrams, etc.) are caught here, rendered inside the parent Layout's `<Outlet />`, so the sidebar stays visible. The root-level `errorElement` is a near-last-resort that does NOT have sidebar/providers (the `App` element is replaced entirely).

Note: The `/invite/:inviteId` and `/auth` routes are standalone and don't need route-level `errorElement` — the top-level class ErrorBoundary (Layer 1) covers them.

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
- Fix: Add `if (diagram === null) return <ResourceDeleted resourceType="diagram" />;` between the loading check (line 113) and the cold-start snapshot fallback (line 118)

**DocumentEditor** (`src/pages/App/Document/DocumentEditor.tsx`):
- The check `if (isLoading || !editor || !document)` lumps `null` (deleted) with `undefined` (loading), showing the loading state forever for deleted documents
- Fix: Add explicit `if (document === null) return <ResourceDeleted resourceType="document" />;` before the loading check

**DocumentEditorContainer** (`src/pages/App/Document/DocumentEditor.tsx`):
- Returns `<p className="p-20">No document selected</p>` for missing params — inconsistent styling
- Fix: Use `<SomethingWentWrong />`

**ChannelDetails** (`src/pages/App/Channel/ChannelDetails.tsx`):
- Returns raw `<div>Workspace not found</div>` for missing `workspaceId` — inconsistent
- Fix: Use `<SomethingWentWrong />`

**ChannelSettings** (`src/pages/App/Channel/ChannelSettings.tsx`):
- Uses `<SomethingWentWrong />` when `channel === null` — should separate `channel === null` (use `<ResourceDeleted resourceType="channel" />`) from `currentUser === null` (keep `<SomethingWentWrong />`)

**WorkspaceDetails** (`src/pages/App/Workspace/WorkspaceDetails.tsx`):
- No null check at all for `workspace` query result — silently renders with empty data
- Fix: Add `if (workspace === null) return <ResourceDeleted resourceType="workspace" />;`

**WorkspaceSettings** (`src/pages/App/Workspace/WorkspaceSettings.tsx`):
- Uses `<SomethingWentWrong />` when `workspace === null` — should use `<ResourceDeleted resourceType="workspace" />`

**ProjectLayout** (`src/pages/App/Project/ProjectLayout.tsx`):
- Uses `<SomethingWentWrong />` when `project === null` — should use `<ResourceDeleted resourceType="project" />`

**TaskDetailPage** (`src/pages/App/Project/TaskDetailPage.tsx`):
- Uses `<SomethingWentWrong />` when `task === null` — should use `<ResourceDeleted resourceType="task" />`

**CycleDetail** (`src/pages/App/Project/CycleDetail.tsx`):
- Uses `<SomethingWentWrong />` when `cycle === null` — should use `<ResourceDeleted resourceType="cycle" />`
- Also has a skeleton/pulse placeholder (`animate-pulse`) that violates the UX principle — replace with empty reserved space

### ResourceDeleted Type Update

Extend the `resourceType` prop to include all resource types:

```typescript
type ResourceDeletedProps = {
  resourceType: "channel" | "document" | "diagram" | "spreadsheet" | "project" | "task" | "cycle" | "workspace";
};
```

## Existing SomethingWentWrong Component

The existing `src/pages/SomethingWentWrong.tsx` remains as-is for the few cases where it's still appropriate (missing route params, `currentUser === null`). Note: it uses `min-h-screen` which can cause layout overflow inside the sidebar — this is a pre-existing issue, out of scope for this change.

## Files Changed

| File | Change |
|---|---|
| `src/components/ErrorBoundary.tsx` | **New** — class-based top-level error boundary |
| `src/components/RouteErrorFallback.tsx` | **New** — route-level error fallback using `useRouteError()` |
| `src/main.tsx` | Wrap providers with `<ErrorBoundary>` |
| `src/routes.tsx` | Add `errorElement` to root and workspace routes |
| `src/pages/ResourceDeleted.tsx` | Add "task", "cycle", "workspace" to resourceType union |
| `src/pages/App/Diagram/DiagramPage.tsx` | Add null check for diagram |
| `src/pages/App/Document/DocumentEditor.tsx` | Add explicit null check for document, fix container fallback |
| `src/pages/App/Channel/ChannelDetails.tsx` | Fix raw div fallback to `SomethingWentWrong` |
| `src/pages/App/Channel/ChannelSettings.tsx` | Separate channel null from currentUser null |
| `src/pages/App/Workspace/WorkspaceDetails.tsx` | Add null check for workspace |
| `src/pages/App/Workspace/WorkspaceSettings.tsx` | Switch to `ResourceDeleted` for null workspace |
| `src/pages/App/Project/ProjectLayout.tsx` | Switch to `ResourceDeleted` for null project |
| `src/pages/App/Project/TaskDetailPage.tsx` | Switch to `ResourceDeleted` for null task |
| `src/pages/App/Project/CycleDetail.tsx` | Switch to `ResourceDeleted` for null cycle, fix skeleton loader |

## Out of Scope

- Convex mutation error handling (already uses toast notifications)
- Network/offline error handling (already handled by collaboration hooks)
- Convex query-level error boundaries (queries return null on failure by convention)
- `SomethingWentWrong` `min-h-screen` layout issue (pre-existing, separate cleanup)
- A `useResourceGuard` hook to reduce null-check boilerplate (potential follow-up)
