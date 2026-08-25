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

// Report inbound deliveries that exhausted their attempts, daily at 4:50 AM
// UTC. Ahead of the retention sweep below, which takes the dead-letter entry
// with the event it names — but the ordering is not what makes that safe: an
// entry is written the moment a delivery dies, a full 30 days before its event
// can expire, so every dead delivery is mirrored long before the sweep reaches
// it. See `webhookDlqMirror.ts`.
crons.cron(
  "webhook dead-letter mirror",
  "50 4 * * *",
  internal.webhookDlqMirror.mirrorDeadDeliveries,
  {},
);

// Enforce the 30-day webhook retention the routes declare, daily at 5:00 AM
// UTC — after storage GC and email retention, so the three heavy sweeps do not
// overlap. Like the resend component, the webhook receiver ships the cleanup
// and schedules none of it; see `webhookMaintenance.ts`.
crons.cron(
  "webhook event retention",
  "0 5 * * *",
  internal.webhookMaintenance.pruneWebhookEvents,
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

// Close out call sessions nothing else will. Hourly like the import sweep, and
// for the same reason: the row this cleans up is one the join path already
// reads past (`ensureMeetingForChannel` asks Cloudflare whether the meeting is
// live), so this is only tidying rows in channels nobody has called since.
crons.interval(
  "expire stale call sessions",
  { hours: 1 },
  internal.callSessions.expireStaleCallSessions,
  {},
);

export default crons;
