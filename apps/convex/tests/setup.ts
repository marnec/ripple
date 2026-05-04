// Suppress noise from convex-test's scheduler firing setTimeout(0) callbacks
// after the test's transaction has already been torn down. Mutations schedule
// side-effects (aggregate updates, push notifications, etc.) that fire on the
// next tick, but by then the parent test transaction is gone, so the scheduled
// function's bookkeeping or its nested runQuery/runMutation hits a stale
// transaction state. These produce three flavors of noise we filter:
//
//   1. unhandledRejection: "Write outside of transaction"
//   2. console.error: 'Error when running scheduled function <name>' followed
//      by "Transaction not started" / "Transaction already committed or rolled
//      back" from convex-test's own catch block.
//
// All harmless — these side-effects aren't asserted on in tests.
process.on("unhandledRejection", (reason) => {
  if (
    reason instanceof Error &&
    (reason.message.includes("Write outside of transaction") ||
      reason.message.includes("Transaction not started") ||
      reason.message.includes("Transaction already committed or rolled back"))
  ) {
    return;
  }
  throw reason;
});

const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  const first = args[0];
  if (typeof first === "string" && first.startsWith("Error when running scheduled function")) {
    const second = args[1];
    if (
      second instanceof Error &&
      (second.message.includes("Write outside of transaction") ||
        second.message.includes("Transaction not started") ||
        second.message.includes("Transaction already committed or rolled back"))
    ) {
      return;
    }
  }
  originalConsoleError(...args);
};
