import { defineApp } from "convex/server";
import auditLog from "convex-audit-log/convex.config.js";
import migrations from "@convex-dev/migrations/convex.config.js";

const app = defineApp();

app.use(auditLog);
app.use(migrations);

export default app;
