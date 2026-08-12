// ── Email delivery env ──────────────────────────────────────────────
// Invite mail is enqueued by `@convex-dev/resend` *inside* the mutation that
// creates the invite, so every test that invites someone now runs the email
// component. Two consequences this file settles once, rather than in each test:
//
//  - `RESEND_TEST_MODE` is required by `emailDelivery.ts` and must be a
//    deliberate value; unset throws.
//  - It is set to "false" here, which is the opposite of what a dev deployment
//    wants, because the component's test mode *rejects* any address outside
//    `{delivered,bounced,complained}@resend.dev` — and since the enqueue shares
//    the caller's transaction, that rejection would roll back the invite and
//    fail ~every existing invite test on its `@example.com` fixtures. Nothing
//    is actually sent: enqueueing only writes the component's own rows, and the
//    HTTP call happens in a scheduled component function no test drives.
//
// `tests/emailDelivery.spike.test.ts` overrides both per-test, since the point
// there is the env handling itself.
process.env.AUTH_RESEND_KEY ??= "re_test_key";
process.env.RESEND_TEST_MODE ??= "false";
process.env.SITE_URL ??= "https://ripple.test";

// Suppress noise from convex-test's scheduler firing setTimeout(0) callbacks
// after the test's transaction (and sometimes the whole Vitest environment) has
// already been torn down. Mutations schedule side-effects (aggregate updates,
// push notifications, invite emails, etc.) that fire on the next tick, but by
// then the parent test transaction is gone, so the scheduled function's
// bookkeeping or its nested runQuery/runMutation hits a stale transaction
// state — or, if the run pool has already advanced, a module it lazily imports
// can no longer be loaded. These produce a few flavors of noise we filter:
//
//   1. unhandledRejection: "Write outside of transaction"
//   2. console.error: 'Error when running scheduled function <name>' followed by
//      a convex-test error: "Transaction not started" / "Transaction already
//      committed or rolled back".
//   3. console.error: 'Error when running scheduled function <name>' followed by
//      an EnvironmentTeardownError ("after the environment was torn down") when a
//      scheduled action lazy-loads a module after Vitest tore the env down.
//   4. console.error: 'Error when running scheduled function emails:*' followed
//      by ConvexError "Missing Resend API key" — invite/cancel emails are
//      scheduled by the mutation under test but no Resend key exists (nor should
//      we send real email) in the test env.
//   5. uncaughtException: 'Patch on non-existent document with ID
//      "..._scheduled_functions"' — convex-test's own scheduler bookkeeping
//      patches the _scheduled_functions system doc from a setTimeout callback
//      after the transaction holding it is gone. Scoped to that system table so
//      a genuine patch-on-missing-doc bug in app code still surfaces.
//
// All harmless — these side-effects aren't asserted on in tests. Tests that DO
// care about scheduled work drain it explicitly via finishAllScheduledFunctions.
const SUPPRESSED_SCHEDULED_ERRORS = [
  "Write outside of transaction",
  "Transaction not started",
  "Transaction already committed or rolled back",
  "after the environment was torn down",
  "Missing Resend API key",
  "_scheduled_functions",
];

const isSuppressedScheduledError = (err: unknown): boolean =>
  err instanceof Error &&
  SUPPRESSED_SCHEDULED_ERRORS.some((msg) => err.message.includes(msg));

process.on("unhandledRejection", (reason) => {
  if (isSuppressedScheduledError(reason)) {
    return;
  }
  throw reason;
});

process.on("uncaughtException", (err) => {
  if (isSuppressedScheduledError(err)) {
    return;
  }
  throw err;
});

const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  const first = args[0];
  if (
    typeof first === "string" &&
    first.startsWith("Error when running scheduled function") &&
    isSuppressedScheduledError(args[1])
  ) {
    return;
  }
  originalConsoleError(...args);
};
