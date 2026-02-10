import { defineApp } from "convex/server";
import migrations from "@convex-dev/migrations/convex.config.js";
import prosemirrorSync from "@convex-dev/prosemirror-sync/convex.config";
import presence from "@convex-dev/presence/convex.config";

const app = defineApp();

app.use(migrations);
app.use(prosemirrorSync);
app.use(presence);

export default app;
