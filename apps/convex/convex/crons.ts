import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Run storage garbage collection daily at 4:00 AM UTC
crons.cron(
  "storage garbage collection",
  "0 4 * * *",
  internal.storageGc.runGarbageCollection,
  { cursor: null },
);

// Prune the email component's records daily at 4:30 AM UTC — after storage GC,
// so the two heavy sweeps do not overlap. The component ships no cron of its
// own; see `emailMaintenance.ts` for why both windows exist.
crons.cron(
  "email record retention",
  "30 4 * * *",
  internal.emailMaintenance.pruneEmailRecords,
  {},
);

// Retire import jobs that stopped making progress. Hourly rather than daily:
// the row this cleans up is one the project's Import button reads, and the
// readers already skip a stale job, so this is only tidying the status a job
// list would otherwise misreport for up to a day.
crons.interval(
  "expire stale import jobs",
  { hours: 1 },
  internal.taskImports.expireStaleImportJobs,
  {},
);

export default crons;
