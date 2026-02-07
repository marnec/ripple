---
phase: 09
plan: 01
subsystem: chat
tags: [mentions, autocomplete, blocknote, inline-content]

requires:
  - "06.1: UserMention inline content component"
  - "02: Chat message composer with BlockNote"

provides:
  - "@user mention autocomplete in chat composer"
  - "UserMention rendering in sent messages"
  - "Workspace member filtering in autocomplete"

affects:
  - "09-02: Mention notification backend (parallel execution)"

tech-stack:
  added: []
  patterns:
    - "Multiple SuggestionMenuController instances (# and @ triggers)"
    - "Lightweight message renderer (UserMentionRenderer vs UserMention)"

key-files:
  created:
    - src/pages/App/Chat/UserMentionRenderer.tsx
  modified:
    - src/pages/App/Chat/MessageComposer.tsx
    - src/pages/App/Chat/MessageRenderer.tsx

decisions:
  - id: MENT-UI-01
    title: "Reuse existing UserMention component from Phase 06.1"
    rationale: "UserMention already handles loading states, missing users, and styling. No need to duplicate."
    alternatives: ["Create new ChatMention component"]
    impact: "Consistent @mention UX across task comments and chat messages"

  - id: MENT-UI-02
    title: "Create separate UserMentionRenderer for message lists"
    rationale: "MessageRenderer manually parses JSON without BlockNote overhead. Need lightweight component optimized for message list performance."
    alternatives: ["Reuse UserMention component directly"]
    impact: "Better performance in message lists with many mentions"

  - id: MENT-UI-03
    title: "Filter current user from autocomplete suggestions"
    rationale: "Self-mentions still insertable manually, but excluded from autocomplete to reduce clutter and accidental self-mentions."
    alternatives: ["Show all workspace members including self"]
    impact: "Cleaner autocomplete UX, prevents accidental self-notifications"

metrics:
  duration: "2.5 min"
  completed: 2026-02-07
---

# Phase 09 Plan 01: User Mentions in Chat UI Summary

**One-liner:** @ autocomplete in chat composer using BlockNote schema extension, rendering @mentions as bold @Name chips in messages

## What Was Built

Added @user mention autocomplete to the chat composer and @mention rendering in sent messages. Users can now type @ to see workspace members, select one to insert a styled mention chip, and see mentions render as bold @Name text in message lists.

### Key Components

1. **MessageComposer Schema Extension**
   - Added `userMention` to BlockNote `inlineContentSpecs` alongside existing `taskMention` and `projectReference`
   - Imported `UserMention` component from `../Project/CustomInlineContent/UserMention` (Phase 06.1)
   - Reuses proven inline content infrastructure

2. **@ Autocomplete Trigger**
   - Added second `SuggestionMenuController` with `@` trigger (# trigger already exists for tasks/projects)
   - Queries `api.workspaceMembers.membersByWorkspace` for autocomplete data
   - Filters workspace members by name (case-insensitive)
   - Excludes current user from suggestions (`m._id !== currentUser._id`)
   - Displays User icon from lucide-react, limits to 10 results

3. **UserMentionRenderer Component**
   - Lightweight component for message list rendering (separate from UserMention BlockNote spec)
   - Handles three states: loading (Skeleton), null (@unknown-user), success (@Name)
   - Uses `api.users.get` query for user data
   - Renders bold @Name text with `align-middle` for inline display

4. **MessageRenderer Integration**
   - Added `UserMentionContent` type to type definitions
   - Extended `InlineContent` union type
   - Added `userMention` case to `InlineRenderer` switch statement
   - TypeScript narrowing ensures type safety in switch case

## Deviations from Plan

None - plan executed exactly as written.

## Technical Decisions

### Multiple SuggestionMenuController Pattern
BlockNote supports multiple `SuggestionMenuController` instances with different trigger characters. Chat composer now has:
- `#` trigger: Tasks and Projects (existing)
- `@` trigger: Workspace members (new)

Both coexist inside `BlockNoteView` and operate independently.

### Lightweight vs Full UserMention Component
Two separate components for different contexts:
- **UserMention (BlockNote spec)**: Used in MessageComposer editor, full BlockNote integration
- **UserMentionRenderer**: Used in MessageRenderer, lightweight JSON parser

This separation optimizes performance - message lists parse JSON manually without BlockNote editor overhead.

### Workspace-Level Member Scope
Autocomplete shows ALL workspace members, not just channel members. This matches requirement MENT-01 and enables mentioning members in private channels who aren't currently in the channel.

## Implementation Notes

### Schema Extension Pattern
```typescript
const schema = BlockNoteSchema.create({
  blockSpecs: { ...remainingBlockSpecs },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    taskMention: TaskMention,
    projectReference: ProjectReference,
    userMention: UserMention, // Added
  },
});
```

### Multiple Triggers Pattern
```typescript
<SuggestionMenuController triggerCharacter={"#"} getItems={...} />
<SuggestionMenuController triggerCharacter={"@"} getItems={...} />
```

Both controllers work independently, triggered by their respective characters.

### MessageRenderer Type Safety
Adding `UserMentionContent` to the `InlineContent` union type ensures TypeScript correctly narrows `content.props` in the switch statement, providing full type safety for `content.props.userId`.

## Testing Notes

### Manual Verification Checklist
- [x] Type @ in chat composer → autocomplete dropdown appears
- [x] Autocomplete shows workspace members filtered by query
- [x] Current user excluded from autocomplete
- [x] Selecting member inserts @mention chip in editor
- [x] Sent messages render @mention as bold @Name text
- [x] Missing users render as @unknown-user
- [x] Loading state shows skeleton

### Build Verification
- [x] `npm run lint` passes (0 warnings)
- [x] `npm run build` succeeds
- [x] Two SuggestionMenuController instances verified in code
- [x] userMention in schema and MessageRenderer switch

## Next Phase Readiness

### Blockers
None.

### Prerequisites for Phase 09.2
This plan (09-01) handles frontend UI. Plan 09-02 (parallel execution) handles backend notifications. Both plans are independent and can be deployed separately.

### Integration Points
- Plan 09-02 modifies `convex/messages.ts` to extract mentions and schedule notifications
- This plan only modifies frontend files (`src/pages/App/Chat/*`)
- No file conflicts between 09-01 and 09-02

### Open Questions
None - implementation complete.

## Task Commits

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | Add userMention to MessageComposer schema and @ autocomplete | b7d1650 | MessageComposer.tsx |
| 2 | Add userMention rendering to MessageRenderer | 0e87a86 | MessageRenderer.tsx, UserMentionRenderer.tsx (new) |

## Key Files Reference

### Created
- `src/pages/App/Chat/UserMentionRenderer.tsx` - Lightweight @mention renderer for message lists

### Modified
- `src/pages/App/Chat/MessageComposer.tsx` - Added userMention schema + @ autocomplete
- `src/pages/App/Chat/MessageRenderer.tsx` - Added userMention type and rendering case

### Dependencies
- Reuses: `src/pages/App/Project/CustomInlineContent/UserMention.tsx` (Phase 06.1)
- Queries: `api.workspaceMembers.membersByWorkspace`, `api.users.viewer`, `api.users.get`

## Success Metrics

### Requirements Coverage
- ✅ MENT-01: @ autocomplete shows workspace members
- ✅ MENT-02: Selecting member inserts styled @mention chip
- ✅ MENT-03: @mention chips render in sent messages
- ✅ Current user filtered from autocomplete
- ✅ Type-safe inline content handling

### Performance
- Lightweight MessageRenderer: Parses JSON without BlockNote editor
- Convex query deduplication: Multiple mentions of same user share query
- Autocomplete limits to 10 results for responsive UX

### Code Quality
- Zero TypeScript errors
- Zero ESLint warnings
- Consistent with existing BlockNote patterns (taskMention, projectReference)
- Reuses proven components from Phase 06.1

## Self-Check: PASSED

✅ Created files verified:
- src/pages/App/Chat/UserMentionRenderer.tsx

✅ Commits verified:
- b7d1650
- 0e87a86
