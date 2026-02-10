---
phase: quick-1
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/pages/App/Project/useTaskDetail.ts
  - src/pages/App/Project/TaskComments.tsx
autonomous: true
must_haves:
  truths:
    - "Clicking on a task opens TaskDetailSheet without BlockNote crash"
    - "Tasks with empty descriptions render a usable editor"
    - "Tasks with corrupted/invalid description JSON do not crash"
    - "Comment plain-text fallback renders without crash"
    - "Submitting a comment and clearing the editor does not crash"
  artifacts:
    - path: "src/pages/App/Project/useTaskDetail.ts"
      provides: "Safe description loading with try-catch and proper empty-block fallback"
    - path: "src/pages/App/Project/TaskComments.tsx"
      provides: "Block objects with id fields in fallback and clear paths"
  key_links:
    - from: "useTaskDetail.ts"
      to: "BlockNote editor"
      via: "editor.replaceBlocks with properly-structured blocks"
      pattern: "replaceBlocks"
---

<objective>
Fix "Block doesn't have id" error that crashes BlockNote when clicking on a task.

Purpose: BlockNote's ProseMirror nodeview requires every block object to have an `id` attribute. Multiple locations in the codebase create block objects without IDs, causing a crash when the editor tries to render them.

Output: Two patched files that ensure all programmatically-created blocks have `id` fields and all JSON parsing is wrapped in try-catch.
</objective>

<execution_context>
@/home/lambda/.claude/get-shit-done/workflows/execute-plan.md
@/home/lambda/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/pages/App/Project/useTaskDetail.ts
@src/pages/App/Project/TaskComments.tsx
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix useTaskDetail.ts description loading</name>
  <files>src/pages/App/Project/useTaskDetail.ts</files>
  <action>
In the `useEffect` that loads description into the editor (around lines 46-58), make these changes:

1. Wrap `JSON.parse(task.description)` in a try-catch. On parse failure, fall through to the empty-description path.

2. Replace the empty-description case `editor.replaceBlocks(editor.document, [])` with a single empty paragraph block that includes an `id` field. Use `crypto.randomUUID()` to generate the ID (available in all modern browsers). The replacement block should be:
   ```typescript
   [{ id: crypto.randomUUID(), type: "paragraph" as const, content: [] }]
   ```

3. Also use the same ID-bearing empty paragraph as the fallback when JSON.parse fails.

The resulting code should look approximately like:

```typescript
suppressOnChangeRef.current = true;
const emptyBlock = [{ id: crypto.randomUUID(), type: "paragraph" as const, content: [] }];
if (task.description) {
  try {
    const blocks = JSON.parse(task.description);
    editor.replaceBlocks(editor.document, blocks);
  } catch {
    editor.replaceBlocks(editor.document, emptyBlock);
  }
} else {
  editor.replaceBlocks(editor.document, emptyBlock);
}
```

Do NOT change any other logic in this file.
  </action>
  <verify>Run `npm run lint` and confirm no TypeScript or ESLint errors in useTaskDetail.ts.</verify>
  <done>Description loading has try-catch protection and all empty-editor states use blocks with proper `id` fields.</done>
</task>

<task type="auto">
  <name>Task 2: Fix TaskComments.tsx block creation</name>
  <files>src/pages/App/Project/TaskComments.tsx</files>
  <action>
Fix two locations in TaskComments.tsx:

**Location 1 - `parseCommentBody` function (line ~32):**
The plain-text fallback creates `{ type: "paragraph", content: body }` without an `id`. Add an `id` field using `crypto.randomUUID()`:
```typescript
return [{ id: crypto.randomUUID(), type: "paragraph", content: body }];
```

**Location 2 - `handleSubmit` clear editor (line ~72):**
After submitting a comment, the editor is cleared with `editor.replaceBlocks(editor.document, [{ type: "paragraph", content: "" }])`. Add an `id` field:
```typescript
editor.replaceBlocks(editor.document, [{ id: crypto.randomUUID(), type: "paragraph", content: "" }]);
```

Do NOT change any other logic in this file. These are minimal, targeted fixes.
  </action>
  <verify>Run `npm run lint` and confirm no TypeScript or ESLint errors in TaskComments.tsx.</verify>
  <done>All programmatically-created blocks in TaskComments.tsx have `id` fields, preventing the "Block doesn't have id" error.</done>
</task>

</tasks>

<verification>
1. `npm run lint` passes with 0 errors and 0 warnings
2. `npm run build` succeeds
3. Manual test: Open a task in the TaskDetailSheet - editor renders without crash
4. Manual test: Open a task with no description - editor renders empty paragraph
5. Manual test: Submit a comment then verify editor clears without crash
</verification>

<success_criteria>
- No "Block doesn't have id" error when clicking on any task
- All three crash locations patched with id-bearing blocks
- JSON.parse of task descriptions wrapped in try-catch
- Lint and build pass cleanly
</success_criteria>

<output>
After completion, create `.planning/quick/1-fix-block-doesn-t-have-id-error-when-cli/1-SUMMARY.md`
</output>
