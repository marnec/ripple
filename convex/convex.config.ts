import { defineApp } from "convex/server";
import aggregate from "@convex-dev/aggregate/convex.config";
import auditLog from "convex-audit-log/convex.config.js";
import migrations from "@convex-dev/migrations/convex.config.js";

const app = defineApp();

app.use(auditLog);
app.use(migrations);

// Workspace resource count aggregates (O(log n) counts per workspace)
app.use(aggregate, { name: "documentsByWorkspace" });
app.use(aggregate, { name: "diagramsByWorkspace" });
app.use(aggregate, { name: "spreadsheetsByWorkspace" });
app.use(aggregate, { name: "projectsByWorkspace" });
app.use(aggregate, { name: "channelsByWorkspace" });
app.use(aggregate, { name: "membersByWorkspace" });
app.use(aggregate, { name: "tasksByWorkspace" });

export default app;
