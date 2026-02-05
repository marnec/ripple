# Coding Conventions

**Analysis Date:** 2026-02-05

## Naming Patterns

**Files:**
- React components: PascalCase with `.tsx` extension (e.g., `Message.tsx`, `MessageComposer.tsx`)
- UI components: lowercase kebab-case with `.tsx` extension (e.g., `button.tsx`, `context-menu.tsx`)
- Utilities and hooks: lowercase with function prefix (e.g., `use-enhanced-presence.tsx`, `utils.ts`)
- Convex backend files: camelCase or dash-separated (e.g., `messages.ts`, `channelMembers.ts`, `push-notifications.ts`)

**Functions:**
- React components and custom hooks: PascalCase (e.g., `Message()`, `MessageComposer()`, `useEnhancedPresence()`)
- Regular functions: camelCase (e.g., `editorIsEmpty()`, `editorClear()`, `sendMessage()`)
- Convex queries/mutations: camelCase exported functions (e.g., `list`, `send`, `update`, `remove`, `create`)

**Variables:**
- Constants: camelCase (e.g., `userId`, `channelId`, `workspaceId`)
- React state: camelCase with descriptive names (e.g., `isEmpty`, `isBold`, `editingMessage`)
- DOM elements/refs: camelCase (e.g., `editor`, `presenceState`)

**Types:**
- Interfaces: PascalCase with `Props` suffix for component props (e.g., `MessageProps`, `MessageComposerProps`)
- Enums: PascalCase, imported from `@shared/enums` (e.g., `ChannelRole`, `DocumentRole`, `WorkspaceRole`)
- Type aliases: PascalCase (e.g., `EnhancedUserPresence`, `MessageWithAuthor`)

## Code Style

**Formatting:**
- Tool: Prettier 3.3.2
- Print width: 100 characters (configured in `.prettierrc`)
- Language: TypeScript with React/JSX

**Linting:**
- Tool: ESLint with TypeScript plugin
- Config: `.eslintrc.cjs`
- Key rules:
  - `@typescript-eslint/no-unused-vars`: Warn on unused vars, but allow variables starting with `_`
  - `react-refresh/only-export-components`: Warn if non-component code is exported from component files
  - `@typescript-eslint/ban-ts-comment`: Error (no TypeScript escape comments allowed)
  - `@typescript-eslint/no-explicit-any`: Disabled (explicit `any` allowed)
  - `@typescript-eslint/require-await`: Disabled (async functions without await allowed for consistency with Convex handlers)
- Max warnings: 0 (zero tolerance)

## Import Organization

**Order:**
1. Third-party libraries (React, Radix UI, external packages)
2. Internal Convex imports (`@convex-dev`, `convex`, `convex-helpers`)
3. Type imports from generated files (`_generated/api`, `_generated/dataModel`)
4. Internal component and utility imports (`@/`, relative paths)
5. Shared types and enums (`@shared/`)

**Path Aliases:**
- `@/*` → `./src/*` (frontend components, hooks, pages)
- `@shared/*` → `./shared/*` (shared types, enums)
- Relative paths used sparingly (e.g., `../../../../convex/_generated/api`)

**Example import block:**
```typescript
import { useQuery } from "convex/react";
import { getAuthUserId } from "@convex-dev/auth/server";
import { api } from "../../convex/_generated/api";
import { Doc } from "../../convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { UserContext } from "@/pages/App/App";
import { ChannelRole } from "@shared/enums";
```

## Error Handling

**Patterns:**
- Convex backend: Use `ConvexError` for user-facing errors with descriptive messages
  - Example: `throw new ConvexError("Not authenticated")`
  - Includes context: `throw new ConvexError(\`Channel not found with id="\${channelId}"\`)`
- Frontend: Catch errors using try-catch and display to user via toast notifications
  - Example: `catch (error) { if (error instanceof ConvexError) { toast({ title: "Error", description: error.data, variant: "destructive" }); } }`
- Error checks performed early in functions (fail fast pattern)
- Authentication checks immediately after getting userId: `if (!userId) throw new ConvexError("Not authenticated")`
- Authorization checks before operations: verify membership or admin role before allowing mutations

**No unhandled errors:**
- All promises that might fail are either awaited with try-catch or use `.catch()` with error handling
- Service worker registration and push notifications include error handlers with `console.error()` or `console.warn()`

## Logging

**Framework:** `console` methods

**Patterns:**
- `console.error()`: For errors that should be logged but may not be fatal (e.g., service worker registration failures, email sending failures)
- `console.warn()`: For warnings (e.g., "No subscription found; considered unregistered")
- `console.info()`: For informational logs (e.g., "Successfully sent notification", "The user accepted the permission request")
- Limited use in production code; mainly for development and error scenarios
- Example locations: `src/events.ts`, `src/hooks/use-push-notifications.tsx`, `convex/pushNotifications.ts`

**No structured logging framework** - just simple console methods

## Comments

**When to Comment:**
- External references: URLs to GitHub issues or documentation (e.g., `// this solution is from https://github.com/shadcn-ui/ui/issues/5545`)
- Complex business logic: Explain why, not what (e.g., `// Batch fetch all users for the messages (cleaner than N+1 pattern)`)
- Non-obvious patterns: Clarify intent (e.g., `// to use as key in react (client generated, same in optimistic update and db)`)
- Workarounds and hacks: Explain the reason (e.g., `// Use a disabled state when no room ID`)

**JSDoc/TSDoc:**
- Minimal use observed
- Interface/type props documented via TypeScript types, not JSDoc
- Function parameters documented via TypeScript types

## Function Design

**Size:** Functions are generally concise and focused
- Utility functions: 1-10 lines (e.g., `cn()` is 5 lines)
- Component functions: 20-100 lines (most components stay under 60 lines)
- Convex handlers: 20-50 lines with clear separation of validation, authorization, and business logic

**Parameters:** Use destructuring for complex objects
```typescript
// Good: Destructure props
export function Message({ message }: MessageProps) { ... }

// Good: Named parameters in destructuring
handler: async (ctx, { id, body, plainText }) => { ... }
```

**Return Values:** Explicit about null/undefined returns
- Frontend components: React elements, never null unless wrapped in conditional rendering
- Convex queries: May return null explicitly with `v.null()` validator, or arrays (empty for not found)
- Convex mutations: Typically return `v.null()` when no data needs to return
- Helper functions: Return the computed value or null on error

## Module Design

**Exports:**
- Named exports preferred: `export const list = query({...})`
- One function per export statement
- Only export handler functions from Convex modules (queries, mutations, actions)

**Barrel Files:**
- Not observed in codebase
- Routes defined explicitly in `src/routes.tsx` with direct imports

**Organization:**
- One logical concern per file
- Convex backend organized by domain (messages.ts, channels.ts, users.ts, etc.)
- Frontend organized by page/feature with nested component directories
- Shared code in `src/lib/` (utils) and `src/hooks/` (custom hooks)

## Convex-Specific Conventions

**Function Syntax (New Style):**
All Convex functions use explicit argument and return validators:
```typescript
export const list = query({
  args: { channelId: v.id("channels"), paginationOpts: paginationOptsValidator },
  returns: v.array(v.object({ ... })),
  handler: async (ctx, args) => { ... },
});
```

**Query Best Practices:**
- Use `withIndex()` over `filter()` for indexed queries (performance)
- Chain `.first()` for single document lookups
- Chain `.unique()` for guaranteed unique results
- Use `getAll()` from `convex-helpers` for batch fetching to avoid N+1 patterns
- Define pagination with `paginationOpts` from `convex/server`
- Use `.order("desc")` or `.order("asc")` for sorted results
- Batch fetch related data: create a `Map` for O(1) lookups when enriching results

**Database Patterns:**
- Check membership immediately after loading entity: verify user has access
- Always check workspace membership for cross-workspace operations
- Define indexes in `convex/schema.ts` with descriptive names (e.g., `by_workspace_user`, `undeleted_by_channel`)
- Use searchIndex for full-text search: `searchIndex("by_text", { searchField: "plainText", filterFields: ["channelId"] })`

**ID Types:**
- Use `v.id("tableName")` for ID validators
- Use `Id<"tableName">` for ID type annotations in TypeScript
- Use `Doc<"tableName">` for full document type annotations

---

*Convention analysis: 2026-02-05*
