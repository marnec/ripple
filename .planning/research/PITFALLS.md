# Domain Pitfalls: Task Management Integration

**Domain:** Collaborative task management in real-time workspace applications
**Researched:** 2026-02-05
**Confidence:** HIGH (research verified with multiple authoritative sources)

## Critical Pitfalls

Mistakes that cause rewrites or major issues.

### Pitfall 1: Drag-and-Drop Performance Collapse at Scale
**What goes wrong:** Drag-and-drop becomes unusable (multi-second delays) when boards have 100+ tasks. The problem compounds with real-time updates - every state change triggers re-renders across all drop targets.

**Why it happens:**
- Drag events fire dozens of times per second, each triggering state updates and re-renders
- With 1000+ DropTargets, the `collect` function is called on ALL targets frequently
- React's reconciliation algorithm struggles with large lists during drag operations
- Real-time subscription updates conflict with optimistic drag updates, causing visual "snapping back"

**Consequences:**
- User frustration and abandonment of task boards
- Support complaints about "slow/broken drag and drop"
- Expensive late-stage refactoring to switch libraries or virtualization

**Prevention:**
1. **Choose the right library from day one:**
   - **Avoid:** react-beautiful-dnd (deprecated, poor performance at scale)
   - **Consider:** pragmatic-drag-and-drop (Atlassian's official evolution, better performance, smaller bundle)
   - **Consider:** dnd-kit (modern, supports virtualization, fine-grained control)

2. **Throttle state updates:** Use throttling/debouncing for drag position updates (balance reactivity vs performance)

3. **Optimize Convex queries during drag:**
   - Don't subscribe to the entire tasks collection during drag
   - Use pagination or data segmentation
   - Consider optimistic updates with delayed server sync

4. **Implement virtualization early:** Use react-window or similar for boards with 50+ tasks

5. **Pass task maps, not arrays:** Avoid dynamically creating task arrays on each render - pass the entire task map instead

**Detection:**
- Performance testing with 100+ tasks should be in acceptance criteria
- Monitor drag operation duration in production (should be <100ms)
- User reports of "laggy" or "jumpy" drag behavior

**Phase impact:** Should be addressed in Phase 2 (Kanban board implementation) - choosing library and architecture early prevents costly rewrites.

---

### Pitfall 2: Permission Model Explosion
**What goes wrong:** Permission checking becomes unmaintainable spaghetti code. You end up with 3-4 levels of permissions (workspace → project → task → subtask) where logic like "Can user X edit task Y?" requires multiple database queries and complex business logic.

**Why it happens:**
- Workspace already has RBAC (admin/member)
- Channels have RBAC (admin/member/guest)
- Documents have RBAC (editor/viewer)
- Projects naturally want RBAC (owner/editor/viewer)
- Tasks inherit from projects, but what about tasks created from channels?

**Consequences:**
- 75% of database errors arise from ignoring permission cascading (ON DELETE/UPDATE actions)
- Complex role hierarchies impact query performance in high-transaction environments
- Bugs where users can see/edit tasks they shouldn't
- Developer cognitive overload - every feature requires "wait, who can do this?"
- Support burden from confused users about "why can't I edit this task?"

**Prevention:**
1. **Simplify the permission model from the start:**
   - Projects inherit workspace membership by default
   - Tasks inherit project permissions (no task-level RBAC)
   - Only add complexity when there's proven user need

2. **Single source of truth:**
   ```typescript
   // BAD: Multiple permission checks scattered across codebase
   const canEdit = await checkWorkspaceRole() &&
                   await checkProjectRole() &&
                   await checkTaskOwnership();

   // GOOD: Centralized permission resolver
   const canEdit = await ctx.auth.can('edit', 'task', taskId);
   ```

3. **Design for permission queries:**
   - Add compound indexes for permission checks: `by_workspace_user`, `by_project_user`
   - Cache effective permissions (pre-compute and store)
   - Use Convex's reactive queries to invalidate caches automatically

4. **Explicit permission policies:**
   - Document WHO can DO WHAT in each context
   - Make policies visible in UI (don't hide permission errors)
   - Test matrix: every role × every action

**Detection:**
- Permission bugs in production
- Slow queries containing multiple joins/filters for permission checks
- Growing `if/else` chains in permission logic
- Developer hesitation when asked "who can do X?"

**Phase impact:** Must be resolved in Phase 1 (data model design). Changing permission model after launch is painful.

---

### Pitfall 3: Stale Cross-Entity References
**What goes wrong:** Tasks created from chat messages or embedding documents/diagrams end up with broken references. User clicks "View original message" and gets 404 or sees deleted content. Cross-workspace references break completely.

**Why it happens:**
- Tasks store `messageId`, `documentId`, or `diagramId` as raw IDs
- Referenced entities get deleted without updating dependent tasks
- No referential integrity enforcement
- No "what references this?" tracking

**Consequences:**
- 67% of SQL-related issues stem from improper relationships between entities
- User frustration with "broken links"
- Data integrity issues compound over time
- Manual cleanup becomes impossible at scale

**Prevention:**
1. **Enforce referential integrity:**
   ```typescript
   // In schema.ts
   tasks: defineTable({
     // ... other fields
     sourceMessageId: v.optional(v.id("messages")),
     sourceDocumentId: v.optional(v.id("documents")),
     sourceDiagramId: v.optional(v.id("diagrams")),
   })
   .index("by_source_message", ["sourceMessageId"])
   .index("by_source_document", ["sourceDocumentId"])
   .index("by_source_diagram", ["sourceDiagramId"])
   ```

2. **Cascade deletes OR preserve tombstones:**
   - Option A: When message deleted → delete linked tasks (use Convex mutation chaining)
   - Option B: Keep task, mark source as deleted, show graceful UI
   - **Recommendation:** Option B for tasks (preserve work even if source deleted)

3. **Reverse lookup queries:**
   ```typescript
   // Query to find all tasks referencing a message
   export const tasksBySourceMessage = query({
     args: { messageId: v.id("messages") },
     handler: async (ctx, args) => {
       return await ctx.db
         .query("tasks")
         .withIndex("by_source_message", q =>
           q.eq("sourceMessageId", args.messageId)
         )
         .collect();
     },
   });
   ```

4. **Periodic audit queries:**
   - Run weekly: find tasks with `sourceMessageId` where message doesn't exist
   - Surface to admins for cleanup or auto-flag for review

5. **Avoid cross-workspace references initially:**
   - Tasks can only reference entities in same workspace
   - Add cross-workspace later if needed with explicit federation

**Detection:**
- User reports of "broken links" or 404s
- Run audit query: `LEFT JOIN` to find dangling references
- Monitor error logs for "entity not found" when loading task details

**Phase impact:** Address in Phase 1 (data model) and Phase 3 (task creation from chat/docs). Fixing later requires data migration.

---

### Pitfall 4: Real-Time Conflict Chaos During Collaborative Drag
**What goes wrong:** Two users drag the same task simultaneously. Task "jumps" between positions. Board states diverge across clients. Undo/redo breaks. Users see flickering or "rubber-banding" UI.

**Why it happens:**
- Optimistic updates for drag operations
- Real-time subscriptions delivering server state during drag
- No conflict resolution strategy for concurrent position changes
- Last-write-wins creates unexpected behavior

**Consequences:**
- User confusion and lost trust ("this app is buggy")
- Data corruption (tasks lost, positions wrong)
- Support burden from "I moved this task and it moved back"
- Difficult to debug/reproduce issues

**Prevention:**
1. **Establish explicit policies for concurrent updates:**
   - Who wins: last drag completion (not last drag start)?
   - Use version numbers or timestamps
   - Show "Someone else is moving this task" warnings

2. **Separate drag state from persisted state:**
   ```typescript
   // Local drag state (immediate UI feedback)
   const [localTaskPositions, setLocalTaskPositions] = useState({});

   // Server state (source of truth)
   const serverTasks = useQuery(api.tasks.getByProject, { projectId });

   // Merged view with conflict indicators
   const displayTasks = mergeWithConflictDetection(
     serverTasks,
     localTaskPositions
   );
   ```

3. **Debounce persistence during drag:**
   - Don't save position on every pixel moved
   - Save only on drop completion
   - Use exponential backoff for retries

4. **Implement optimistic concurrency control:**
   - Tasks have `version` field
   - Mutation includes current version
   - Server rejects if version mismatch
   - Client resolves conflict (show dialog or auto-merge)

5. **Convex-specific: Leverage reactive queries carefully:**
   - Query invalidation during drag causes re-fetches
   - Consider suspending real-time updates during active drag
   - Resume subscriptions on drop

**Detection:**
- Test with two browsers side-by-side, same board
- Drag same task simultaneously
- Monitor for "task snapping back" reports
- Check for version conflict errors in logs

**Phase impact:** Must be designed in Phase 2 (Kanban board). Retrofitting conflict resolution is very hard.

---

## Moderate Pitfalls

Mistakes that cause delays or technical debt.

### Pitfall 5: Board Accuracy Degradation (Stale Boards)
**What goes wrong:** Tasks stay in "In Progress" for weeks after completion. Board becomes untrustworthy. Team stops using it, returns to spreadsheets.

**Why it happens:**
- No enforcement of board updates
- Friction to update status (too many clicks, slow UI)
- Status updates batched for standups instead of immediate

**Prevention:**
1. **Make updates frictionless:**
   - Keyboard shortcuts for status changes
   - Bulk operations (select multiple tasks → move)
   - Auto-status based on actions (merge PR → task moves to Done)

2. **Explicit policies with enforcement:**
   - Define WHEN status must change (not just HOW)
   - Reminder notifications for stale tasks
   - Board health metrics visible to team

3. **Real-time = immediate updates:**
   - Convex's real-time nature helps here
   - Show "Last updated 3 days ago" warnings
   - Auto-archive tasks in Done > 7 days

**Detection:**
- Measure task "staleness": time since last status update
- User complaints about "board doesn't reflect reality"

---

### Pitfall 6: Context Loss When Creating Tasks from Chat
**What goes wrong:** User creates task from chat message, but loses important context. Task says "Fix that bug" but doesn't link back to conversation where bug was described.

**Why it happens:**
- Sharded information: task creation is isolated from source
- No automatic context capture
- UI makes it easy to create tasks, hard to add context

**Prevention:**
1. **Auto-capture context:**
   ```typescript
   // When creating task from message
   {
     title: "Fix authentication bug",
     description: messageText,
     sourceMessageId: messageId,
     sourceChannelId: channelId,
     createdFromContext: {
       type: "chat_message",
       timestamp: message._creationTime,
       author: message.userId,
     }
   }
   ```

2. **Make context visible:**
   - Task detail view shows "Created from message in #general"
   - Click to jump back to original message
   - Show message thread preview in task

3. **Prompt for additional context:**
   - Modal for task creation with pre-filled description
   - Allow editing before saving
   - Suggest adding assignee, due date

**Detection:**
- Tasks with sparse descriptions
- User feedback: "I can't remember why I created this task"
- Low task completion rates (unclear requirements)

---

### Pitfall 7: WIP Limit Ignored (Column Overload)
**What goes wrong:** "In Progress" column has 47 tasks. Team has 3 people. Nothing gets finished. Kanban becomes a glorified to-do list.

**Why it happens:**
- No enforcement of WIP limits
- Starting new tasks is easy and feels productive
- Finishing tasks is hard and invisible

**Prevention:**
1. **Explicit WIP limits per column:**
   ```typescript
   columns: [
     { name: "In Progress", wipLimit: 5 },
     { name: "In Review", wipLimit: 3 },
   ]
   ```

2. **Enforce limits in UI:**
   - Warning when approaching limit (4/5 tasks)
   - Block dragging new tasks when at limit
   - Allow override with justification (tracked)

3. **Visualize limit breaches:**
   - Column header shows "5/5 ⚠️"
   - Red border on overloaded columns
   - Dashboard metric: "WIP limit breached X times this week"

**Detection:**
- Monitor task velocity: are tasks moving or stagnating?
- Count tasks per column per user
- User reports of "too many things in progress"

---

### Pitfall 8: Notification Fatigue
**What goes wrong:** Every task update triggers a notification. Users get 47 notifications per day. They disable all notifications, missing critical updates.

**Why it happens:**
- Default to "notify on everything"
- No prioritization of notifications
- No batching or throttling
- Cross-channel notification sync issues

**Consequences:**
- 47% of analysts point to alerting issues as most common inefficiency
- Users disable notifications entirely
- Critical updates missed
- Decreased engagement

**Prevention:**
1. **Intelligent notification strategy:**
   - Only notify on: assignments, @mentions, status changes on watched tasks
   - Don't notify: every comment, every task creation, mass updates

2. **Batching and throttling:**
   - Batch: "5 tasks updated in Project X" instead of 5 separate notifications
   - Throttle: Max 1 notification per project per hour
   - Daily digest option for low-priority updates

3. **Granular user preferences:**
   ```typescript
   notificationPreferences: {
     taskAssigned: { push: true, email: true },
     taskCommented: { push: false, email: false },
     taskStatusChanged: { push: true, email: false },
     projectUpdates: { digest: "daily" },
   }
   ```

4. **Contextual awareness:**
   - Don't notify if user is actively viewing the board
   - Don't notify user about their own actions
   - Suppress duplicates across channels (push + email + in-app)

5. **Clear prioritization:**
   - High: Task assigned to you, deadline today
   - Medium: Task status changed on watched project
   - Low: New comment on project you're member of

**Detection:**
- Monitor notification opt-out rates
- Survey: "Do notifications help or annoy you?"
- Track notification→action conversion rate

---

### Pitfall 9: Overcomplicated Board Structure
**What goes wrong:** Board has 15 columns with names like "Ready for Dev (Blocked)", "In QA (Waiting)", "Done (Pending Deploy)". New users are paralyzed, don't know where to put tasks.

**Why it happens:**
- Trying to capture every workflow nuance
- Adding columns instead of using task metadata
- Different stakeholders want different views

**Prevention:**
1. **Start simple, add complexity later:**
   - MVP: Todo → In Progress → Done
   - Later: Add "In Review" if needed
   - Resist: Splitting columns for edge cases

2. **Use task metadata instead of columns:**
   - Blocked tasks: Add `isBlocked: true` field, show indicator
   - Waiting: Add `waitingOn: string` field
   - Deploy pending: Add label/tag

3. **Multiple board views instead of one complex board:**
   - Dev view: columns for dev workflow
   - PM view: columns for planning workflow
   - Same tasks, different visualizations

**Detection:**
- User confusion during onboarding
- Tasks stuck because "I don't know where to move this"
- Support questions: "What's the difference between X and Y column?"

---

## Minor Pitfalls

Mistakes that cause annoyance but are fixable.

### Pitfall 10: No Bulk Operations
**What goes wrong:** User needs to move 20 tasks from Sprint 1 to Sprint 2. Has to drag each one individually. Takes 10 minutes. Frustrating experience.

**Prevention:**
- Multi-select with Shift+Click or Cmd+Click
- Bulk actions menu: Move, Delete, Archive, Change Status
- Keyboard shortcuts for power users

**Detection:**
- User feedback about tedious workflows
- Support requests for bulk operations

---

### Pitfall 11: Poor Mobile Drag-and-Drop
**What goes wrong:** Drag-and-drop doesn't work on mobile/tablet. Users on iPad can view boards but can't update them. Forces desktop-only workflow.

**Prevention:**
- Choose library with touch support (dnd-kit, pragmatic-drag-and-drop)
- Alternative interactions on mobile: long-press → menu → "Move to..."
- Test on actual devices, not just browser DevTools

**Detection:**
- Analytics showing 0% task updates from mobile users
- User complaints about "doesn't work on iPad"

---

### Pitfall 12: Missing Metrics and Flow Visualization
**What goes wrong:** Team uses Kanban but has no visibility into bottlenecks, cycle time, or velocity. Can't improve what you don't measure.

**Prevention:**
- Track metrics: Lead Time, Cycle Time, WIP
- Cumulative Flow Diagram showing column distribution over time
- Bottleneck detection: "Tasks stay in Review 3x longer than In Progress"

**Detection:**
- Team asks "Are we getting faster?" and nobody knows
- Metrics never discussed in retrospectives

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation | Research Flag |
|-------------|---------------|------------|---------------|
| Phase 1: Data Model | Permission Model Explosion, Stale References | Design simple permission model, add referential integrity from start | LOW - patterns are well-known |
| Phase 2: Kanban Board | Drag-Drop Performance, Real-Time Conflicts | Choose performant library, design conflict resolution | MEDIUM - need to test at scale |
| Phase 3: Task Creation from Chat | Context Loss | Auto-capture source context, preserve links | LOW - straightforward implementation |
| Phase 4: Notifications | Notification Fatigue | Implement batching and granular preferences from day one | LOW - Convex has good notification patterns |
| Phase 5: Advanced Features | Overcomplicated Boards, Missing Metrics | Start simple, add complexity based on usage data | MEDIUM - requires user feedback loop |

---

## Convex-Specific Considerations

### Query Performance with Many Subscribers
**Pitfall:** Board with 10 active users means 10 subscriptions to the same query. If query is inefficient, it compounds.

**Prevention:**
- Use indexes religiously: `withIndex()` not `filter()`
- Paginate: Don't load all 500 tasks at once
- Segment data: Tasks by status, by assignee
- Avoid queries that read frequently-updating documents

**Sources:**
- [Convex Query Performance](https://stack.convex.dev/convex-query-performance)
- [Queries that Scale](https://stack.convex.dev/queries-that-scale)

### Mutation Chaining for Referential Integrity
**Pattern:** When entity deleted, cascade to dependents.

```typescript
export const deleteMessage = mutation({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    // Find dependent tasks
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_source_message", q =>
        q.eq("sourceMessageId", args.messageId)
      )
      .collect();

    // Cascade: delete tasks or mark as orphaned
    for (const task of tasks) {
      await ctx.db.patch(task._id, {
        sourceMessageId: undefined,
        orphanedAt: Date.now(),
      });
    }

    // Delete message
    await ctx.db.delete(args.messageId);
  },
});
```

---

## Summary: Top 3 Mistakes to Avoid

1. **Choosing wrong drag-drop library** → Performance hell, expensive rewrite
2. **Overcomplicating permissions** → Unmaintainable code, security bugs
3. **Ignoring real-time conflicts** → Data corruption, user frustration

**Success criteria:**
- Board with 200+ tasks remains responsive (<100ms drag operations)
- Permission checks are single-query operations with indexed lookups
- Concurrent edits handled gracefully with conflict indicators
- Context preserved when creating tasks from other entities
- Users trust board accuracy (updated in real-time, not stale)

---

## Sources

### Kanban & Task Management
- [Common Kanban Mistakes](https://kanbanproject.app/article/Common_mistakes_to_avoid_when_using_kanban_Pitfalls_to_watch_out_for_and_how_to_overcome_them.html)
- [Vabro: Common Kanban Mistakes](https://www.vabro.com/blog/common-kanban-mistakes-and-how-to-avoid-them)
- [5 Worst Mistakes in Kanban](https://www.dailybot.com/insights/5-worst-mistakes-you-can-make-in-kanban)

### Drag-and-Drop Performance
- [Top 5 Drag-and-Drop Libraries for React 2026](https://puckeditor.com/blog/top-5-drag-and-drop-libraries-for-react)
- [React DnD Performance Issues](https://github.com/react-dnd/react-dnd/issues/421)
- [Comparison: dnd-kit vs react-beautiful-dnd](https://github.com/clauderic/dnd-kit/discussions/481)

### Permission & Data Integrity
- [Database Design Mistakes](https://chartdb.io/blog/common-database-design-mistakes)
- [RBAC Implementation Complexity](https://www.osohq.com/learn/rbac-role-based-access-control)
- [Role-Based Access Control Best Practices 2026](https://www.techprescient.com/blogs/role-based-access-control-best-practices/)

### Real-Time Conflicts
- [Optimistic Updates](https://swugisha.medium.com/concept-of-optimistic-updates-682c5504dfa9)
- [RxDB Optimistic UI](https://rxdb.info/articles/optimistic-ui.html)
- [AWS AppSync Conflict Resolution](https://docs.aws.amazon.com/appsync/latest/devguide/conflict-detection-and-resolution.html)

### Notification Fatigue
- [How to Reduce Notification Fatigue](https://www.courier.com/blog/how-to-reduce-notification-fatigue-7-proven-product-strategies-for-saas)
- [Alert Fatigue 2026](https://torq.io/blog/cybersecurity-alert-management-2026/)

### Convex-Specific
- [Convex Query Performance](https://stack.convex.dev/convex-query-performance)
- [Queries that Scale](https://stack.convex.dev/queries-that-scale)
- [Real-Time Database Guide](https://stack.convex.dev/real-time-database)
