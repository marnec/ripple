// Suppress "Write outside of transaction" errors from convex-test component scheduled functions.
// The audit log component schedules async aggregate updates via ctx.scheduler.runAfter(),
// which convex-test cannot execute properly outside the transaction boundary.
// These are harmless in tests — aggregates are only used for analytics, not core functionality.
process.on("unhandledRejection", (reason) => {
  if (
    reason instanceof Error &&
    reason.message.includes("Write outside of transaction")
  ) {
    return;
  }
  // Re-throw other unhandled rejections
  throw reason;
});
