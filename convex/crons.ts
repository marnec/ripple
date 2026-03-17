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

export default crons;
