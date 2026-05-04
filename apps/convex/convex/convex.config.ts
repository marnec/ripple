import { defineApp } from "convex/server";
import aggregate from "@convex-dev/aggregate/convex.config";
import auditLog from "convex-audit-log/convex.config.js";
import cascadingDelete from "convex-cascading-delete/convex.config.js";
import migrations from "@convex-dev/migrations/convex.config.js";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";
import workpool from "@convex-dev/workpool/convex.config";

const app = defineApp();

app.use(auditLog);
app.use(cascadingDelete);
app.use(migrations);
app.use(rateLimiter);
app.use(workpool, { name: "notificationPool" });
app.use(workpool, { name: "taskReassignPool" });

// Workspace resource count aggregates (O(log n) counts per workspace)
app.use(aggregate, { name: "documentsByWorkspace" });
app.use(aggregate, { name: "diagramsByWorkspace" });
app.use(aggregate, { name: "spreadsheetsByWorkspace" });
app.use(aggregate, { name: "projectsByWorkspace" });
app.use(aggregate, { name: "channelsByWorkspace" });
app.use(aggregate, { name: "membersByWorkspace" });
app.use(aggregate, { name: "tasksByWorkspace" });

export default app;
