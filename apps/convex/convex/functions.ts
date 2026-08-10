/**
 * The project's mutation builders.
 *
 * `dbTriggers.ts` registers ~31 triggers that maintain denormalized state:
 * the workspace resource aggregates, the polymorphic `nodes` index, the
 * `taskTags` join columns the tag-filtered board queries partition on, the tag
 * uniqueness invariants, and the notification-subscription view. None of that
 * fires for a bare `ctx.db` write — the writer has to be trigger-aware.
 *
 * Every mutation in this app is therefore defined with the builders here, which
 * hand the handler a `ctx` whose `db` is already wrapped. Writing correct
 * denormalization stops being something each call site has to remember: there
 * is one way in, and `ctx.db` is it.
 *
 * Two corollaries:
 *
 * 1. Do NOT re-wrap inside a handler. `writerWithTriggers(ctx, ctx.db, ...)` on
 *    an already-wrapped `ctx.db` does not merely fire triggers twice — both
 *    layers take convex-helpers' module-level `outerWriteLock`, so the inner
 *    write waits on a lock the outer write holds and the mutation deadlocks.
 * 2. `tests/triggerWriteGuard.test.ts` enforces both of the above structurally
 *    (`apps/convex`'s lint step is `tsc` only, so the guard lives in the suite).
 *
 * Two deliberate exceptions, both pinned by that test's allowlists:
 *
 * - `auth.ts`'s Convex Auth callbacks never pass through these builders, so they
 *   apply `withTriggers` by hand.
 * - `migrations.ts` stays on the raw builder on purpose. It is the *repair* path
 *   for trigger-maintained state — `backfillDocumentAggregates` calls the
 *   aggregate's `insertIfDoesNotExist` itself, `backfill*Nodes` writes `nodes`
 *   rows by hand — so running it through the triggers would have each backfill
 *   fighting the thing it exists to repair.
 */
import {
  mutation as rawMutation,
  internalMutation as rawInternalMutation,
} from "./_generated/server";
import { customCtx, customMutation } from "convex-helpers/server/customFunctions";
import { triggers } from "./dbTriggers";

/** Public mutation. `ctx.db` fires the triggers registered in `dbTriggers.ts`. */
export const mutation = customMutation(rawMutation, customCtx(triggers.wrapDB));

/** Internal mutation. Same wrapping as `mutation`. */
export const internalMutation = customMutation(
  rawInternalMutation,
  customCtx(triggers.wrapDB),
);
