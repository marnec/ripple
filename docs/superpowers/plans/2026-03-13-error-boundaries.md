# Error Boundaries Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add error boundaries at two layers (top-level class boundary + React Router errorElement) and fix inconsistent null-check handling across all resource pages.

**Architecture:** A class-based `ErrorBoundary` wraps all providers in `main.tsx` as a last-resort. React Router `errorElement` on root and workspace routes catches errors inside the layout (preserving sidebar). All resource pages are audited to use the `undefined`=loading / `null`=ResourceDeleted convention consistently.

**Tech Stack:** React 19, React Router v6, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-03-13-error-boundaries-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/components/ErrorBoundary.tsx` | Create | Top-level class error boundary (last-resort, full-page fallback) |
| `src/components/RouteErrorFallback.tsx` | Create | Route-level error fallback using `useRouteError()` |
| `src/main.tsx` | Modify | Wrap providers with `<ErrorBoundary>` |
| `src/routes.tsx` | Modify | Add `errorElement` to root and workspace routes |
| `src/pages/ResourceDeleted.tsx` | Modify | Extend resourceType union |
| `src/pages/App/Diagram/DiagramPage.tsx` | Modify | Add null check |
| `src/pages/App/Document/DocumentEditor.tsx` | Modify | Add null check, fix container fallback |
| `src/pages/App/Channel/ChannelDetails.tsx` | Modify | Fix raw div fallback |
| `src/pages/App/Channel/ChannelSettings.tsx` | Modify | Separate channel null from user null |
| `src/pages/App/Workspace/WorkspaceDetails.tsx` | Modify | Add null check |
| `src/pages/App/Workspace/WorkspaceSettings.tsx` | Modify | Switch to ResourceDeleted |
| `src/pages/App/Project/ProjectLayout.tsx` | Modify | Switch to ResourceDeleted |
| `src/pages/App/Project/TaskDetailPage.tsx` | Modify | Switch to ResourceDeleted |
| `src/pages/App/Project/CycleDetail.tsx` | Modify | Switch to ResourceDeleted, fix skeleton |

---

## Chunk 1: Error Boundary Components

### Task 1: Create Top-Level ErrorBoundary

**Files:**
- Create: `src/components/ErrorBoundary.tsx`

- [ ] **Step 1: Create the ErrorBoundary class component**

```tsx
import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { hasError: boolean };

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Top-level error boundary caught:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center p-4 text-center">
          <h1 className="text-3xl font-semibold mb-4">Something Went Wrong</h1>
          <p className="mb-6 text-gray-600">
            An unexpected error occurred. Please reload the page.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
          >
            Reload Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
```

Note: Uses plain Tailwind with hardcoded colors (not theme tokens) because this renders when all providers (including ThemeProvider) may be broken.

- [ ] **Step 2: Verify lint passes**

Run: `npx tsc --noEmit --pretty`
Expected: No errors related to ErrorBoundary.tsx

- [ ] **Step 3: Commit**

```bash
git add src/components/ErrorBoundary.tsx
git commit -m "feat: add top-level ErrorBoundary class component"
```

### Task 2: Create RouteErrorFallback

**Files:**
- Create: `src/components/RouteErrorFallback.tsx`

- [ ] **Step 1: Create the RouteErrorFallback component**

```tsx
import { AlertTriangle } from "lucide-react";
import { isRouteErrorResponse, useNavigate, useRouteError } from "react-router-dom";

export function RouteErrorFallback() {
  const error = useRouteError();
  const navigate = useNavigate();

  const is404 = isRouteErrorResponse(error) && error.status === 404;

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
      <AlertTriangle className="h-12 w-12 text-muted-foreground mb-4" />
      <h2 className="text-xl font-semibold mb-2">
        {is404 ? "Page not found" : "Something went wrong"}
      </h2>
      <p className="text-muted-foreground mb-6 max-w-md">
        {is404
          ? "The page you're looking for doesn't exist or has been moved."
          : "An unexpected error occurred. You can try again or go back."}
      </p>
      <div className="flex gap-3">
        <button
          onClick={() => void navigate(-1)}
          className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent transition-colors"
        >
          Go back
        </button>
        <button
          onClick={() => void navigate(0)}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
```

Note: This component uses theme tokens (`text-muted-foreground`, `bg-primary`, etc.) because when rendered at the `workspaces/:workspaceId` level the ThemeProvider is still active. At the root level, theme tokens may not resolve correctly, but the component remains functional — the colors just fall back to browser defaults.

- [ ] **Step 2: Verify lint passes**

Run: `npx tsc --noEmit --pretty`
Expected: No errors related to RouteErrorFallback.tsx

- [ ] **Step 3: Commit**

```bash
git add src/components/RouteErrorFallback.tsx
git commit -m "feat: add RouteErrorFallback for React Router errorElement"
```

### Task 3: Wire up ErrorBoundary in main.tsx

**Files:**
- Modify: `src/main.tsx`

- [ ] **Step 1: Add ErrorBoundary import and wrap providers**

In `src/main.tsx`, add the import:
```tsx
import { ErrorBoundary } from "./components/ErrorBoundary";
```

Then wrap the `<ThemeProvider>` (and everything inside it) with `<ErrorBoundary>`:

Change from:
```tsx
<React.StrictMode>
    <ThemeProvider attribute="class">
```
To:
```tsx
<React.StrictMode>
  <ErrorBoundary>
    <ThemeProvider attribute="class">
```

And add the closing tag before `</React.StrictMode>`:
```tsx
    </ThemeProvider>
  </ErrorBoundary>
</React.StrictMode>
```

- [ ] **Step 2: Verify lint passes**

Run: `npx tsc --noEmit --pretty`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/main.tsx
git commit -m "feat: wrap app providers with top-level ErrorBoundary"
```

### Task 4: Wire up errorElement in routes.tsx

**Files:**
- Modify: `src/routes.tsx`

- [ ] **Step 1: Add import and errorElement to routes**

In `src/routes.tsx`, add the import:
```tsx
import { RouteErrorFallback } from "./components/RouteErrorFallback";
```

Add `errorElement` to the root route:
```tsx
{
  path: "/",
  element: <App />,
  errorElement: <RouteErrorFallback />,
  children: [
```

Add `errorElement` to the workspace route. Find:
```tsx
        {
          path: "workspaces/:workspaceId",
          children: [
```
Change to:
```tsx
        {
          path: "workspaces/:workspaceId",
          errorElement: <RouteErrorFallback />,
          children: [
```

- [ ] **Step 2: Verify lint passes**

Run: `npx tsc --noEmit --pretty`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/routes.tsx
git commit -m "feat: add errorElement to root and workspace routes"
```

---

## Chunk 2: Null Check Audit

### Task 5: Extend ResourceDeleted types

**Files:**
- Modify: `src/pages/ResourceDeleted.tsx`

- [ ] **Step 1: Add "task", "cycle", "workspace" to the type union**

In `src/pages/ResourceDeleted.tsx`, change:
```tsx
type ResourceDeletedProps = {
  resourceType: "channel" | "document" | "diagram" | "spreadsheet" | "project";
};
```
To:
```tsx
type ResourceDeletedProps = {
  resourceType: "channel" | "document" | "diagram" | "spreadsheet" | "project" | "task" | "cycle" | "workspace";
};
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/ResourceDeleted.tsx
git commit -m "feat: extend ResourceDeleted to support task, cycle, workspace types"
```

### Task 6: Fix DiagramPage null check

**Files:**
- Modify: `src/pages/App/Diagram/DiagramPage.tsx`

- [ ] **Step 1: Add ResourceDeleted import and null check**

Add import at top of file:
```tsx
import { ResourceDeleted } from "@/pages/ResourceDeleted";
```

In the `DiagramPageContent` component, find (around line 113):
```tsx
  if (!viewer || diagram === undefined) {
    return <div className="h-full w-full" />;
  }
```

Add immediately after that block:
```tsx
  if (diagram === null) {
    return <ResourceDeleted resourceType="diagram" />;
  }
```

- [ ] **Step 2: Verify lint passes**

Run: `npx tsc --noEmit --pretty`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/pages/App/Diagram/DiagramPage.tsx
git commit -m "fix: add null check for deleted/inaccessible diagrams"
```

### Task 7: Fix DocumentEditor null check

**Files:**
- Modify: `src/pages/App/Document/DocumentEditor.tsx`

- [ ] **Step 1: Add ResourceDeleted import and null check**

Add import at top of file:
```tsx
import { ResourceDeleted } from "@/pages/ResourceDeleted";
```

In `DocumentEditorContainer`, change:
```tsx
  if (!documentId) {
    return <p className="p-20">No document selected</p>;
  }
```
To:
```tsx
  if (!documentId) {
    return <SomethingWentWrong />;
  }
```

Add the SomethingWentWrong import if not already present:
```tsx
import SomethingWentWrong from "@/pages/SomethingWentWrong";
```

In `DocumentEditor`, find the loading check (around line 246):
```tsx
  if (isLoading || !editor || !document) {
    return <div className="h-full flex-1 min-w-0" />;
  }
```

Add immediately **before** that block:
```tsx
  if (document === null) {
    return <ResourceDeleted resourceType="document" />;
  }
```

- [ ] **Step 2: Verify lint passes**

Run: `npx tsc --noEmit --pretty`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/pages/App/Document/DocumentEditor.tsx
git commit -m "fix: add null check for deleted/inaccessible documents"
```

### Task 8: Fix ChannelDetails fallback

**Files:**
- Modify: `src/pages/App/Channel/ChannelDetails.tsx`

- [ ] **Step 1: Replace raw div with SomethingWentWrong**

Add import:
```tsx
import SomethingWentWrong from "@/pages/SomethingWentWrong";
```

Change:
```tsx
  if (!workspaceId) {
    return <div>Workspace not found</div>;
  }
```
To:
```tsx
  if (!workspaceId) {
    return <SomethingWentWrong />;
  }
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/App/Channel/ChannelDetails.tsx
git commit -m "fix: use SomethingWentWrong for missing workspace param in ChannelDetails"
```

### Task 9: Fix ChannelSettings null check separation

**Files:**
- Modify: `src/pages/App/Channel/ChannelSettings.tsx`

- [ ] **Step 1: Separate channel null from currentUser null**

Add import:
```tsx
import { ResourceDeleted } from "@/pages/ResourceDeleted";
```

In `ChannelSettingsContent`, find (around line 39):
```tsx
  if (channel === null || currentUser === null) {
    return <SomethingWentWrong />;
  }
```

Change to:
```tsx
  if (channel === null) {
    return <ResourceDeleted resourceType="channel" />;
  }

  if (currentUser === null) {
    return <SomethingWentWrong />;
  }
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/App/Channel/ChannelSettings.tsx
git commit -m "fix: use ResourceDeleted for deleted channel in ChannelSettings"
```

### Task 10: Fix WorkspaceDetails null check

**Files:**
- Modify: `src/pages/App/Workspace/WorkspaceDetails.tsx`

- [ ] **Step 1: Add null check for workspace**

Add import:
```tsx
import { ResourceDeleted } from "@/pages/ResourceDeleted";
```

In `WorkspaceDetails`, add a null check after the query declarations and before the return. Find:
```tsx
  const workspace = useQuery(api.workspaces.get, { id });
  const overview = useQuery(api.workspaces.overview, { workspaceId: id });

  return (
```

Change to:
```tsx
  const workspace = useQuery(api.workspaces.get, { id });
  const overview = useQuery(api.workspaces.overview, { workspaceId: id });

  if (workspace === null) {
    return <ResourceDeleted resourceType="workspace" />;
  }

  return (
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/App/Workspace/WorkspaceDetails.tsx
git commit -m "fix: add null check for deleted/inaccessible workspace in WorkspaceDetails"
```

### Task 11: Fix WorkspaceSettings null check

**Files:**
- Modify: `src/pages/App/Workspace/WorkspaceSettings.tsx`

- [ ] **Step 1: Switch from SomethingWentWrong to ResourceDeleted**

Add import:
```tsx
import { ResourceDeleted } from "@/pages/ResourceDeleted";
```

Change:
```tsx
  if (workspace === null) {
    return <SomethingWentWrong />;
  }
```
To:
```tsx
  if (workspace === null) {
    return <ResourceDeleted resourceType="workspace" />;
  }
```

Remove the `SomethingWentWrong` import if it's no longer used in this file.

- [ ] **Step 2: Commit**

```bash
git add src/pages/App/Workspace/WorkspaceSettings.tsx
git commit -m "fix: use ResourceDeleted for deleted workspace in WorkspaceSettings"
```

### Task 12: Fix ProjectLayout null check

**Files:**
- Modify: `src/pages/App/Project/ProjectLayout.tsx`

- [ ] **Step 1: Switch from SomethingWentWrong to ResourceDeleted for null project**

Add import:
```tsx
import { ResourceDeleted } from "@/pages/ResourceDeleted";
```

In `ProjectLayoutContent`, change:
```tsx
  if (project === null) {
    return <SomethingWentWrong />;
  }
```
To:
```tsx
  if (project === null) {
    return <ResourceDeleted resourceType="project" />;
  }
```

Note: Keep the `SomethingWentWrong` import — it's still used in `ProjectLayout` for missing route params.

- [ ] **Step 2: Commit**

```bash
git add src/pages/App/Project/ProjectLayout.tsx
git commit -m "fix: use ResourceDeleted for deleted project in ProjectLayout"
```

### Task 13: Fix TaskDetailPage null check

**Files:**
- Modify: `src/pages/App/Project/TaskDetailPage.tsx`

- [ ] **Step 1: Switch from SomethingWentWrong to ResourceDeleted for null task**

Add import:
```tsx
import { ResourceDeleted } from "@/pages/ResourceDeleted";
```

In `TaskDetailPageContent`, change:
```tsx
  if (detail.task === null) {
    return <SomethingWentWrong />;
  }
```
To:
```tsx
  if (detail.task === null) {
    return <ResourceDeleted resourceType="task" />;
  }
```

Note: Keep the `SomethingWentWrong` import — it's still used in `TaskDetailPage` for missing route params.

- [ ] **Step 2: Commit**

```bash
git add src/pages/App/Project/TaskDetailPage.tsx
git commit -m "fix: use ResourceDeleted for deleted task in TaskDetailPage"
```

### Task 14: Fix CycleDetail null check and skeleton

**Files:**
- Modify: `src/pages/App/Project/CycleDetail.tsx`

- [ ] **Step 1: Switch from SomethingWentWrong to ResourceDeleted and fix skeleton**

Add import:
```tsx
import { ResourceDeleted } from "@/pages/ResourceDeleted";
```

Change:
```tsx
  if (cycle === null) {
    return <SomethingWentWrong />;
  }
```
To:
```tsx
  if (cycle === null) {
    return <ResourceDeleted resourceType="cycle" />;
  }
```

Fix the skeleton/pulse loader (UX violation). Change:
```tsx
  if (cycle === undefined) {
    return <div className="flex-1 flex flex-col min-h-0"><div className="px-4 py-2.5 md:px-8 border-b"><div className="h-5 w-48 bg-muted animate-pulse rounded" /></div></div>;
  }
```
To:
```tsx
  if (cycle === undefined) {
    return <div className="flex-1 flex flex-col min-h-0"><div className="px-4 py-2.5 md:px-8 border-b"><div className="h-5 w-48" /></div></div>;
  }
```

Note: Keep the `SomethingWentWrong` import — it's still used in `CycleDetail` for missing route params.

- [ ] **Step 2: Commit**

```bash
git add src/pages/App/Project/CycleDetail.tsx
git commit -m "fix: use ResourceDeleted for deleted cycle, remove skeleton loader"
```

---

## Chunk 3: Verify

### Task 15: Final verification

- [ ] **Step 1: Run TypeScript check**

Run: `npx tsc --noEmit --pretty`
Expected: No errors

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: No errors or warnings

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 4: Verify unused imports are cleaned up**

Check that `SomethingWentWrong` is not imported in files where it's no longer used (WorkspaceSettings). The lint step should catch this, but verify manually if needed.
