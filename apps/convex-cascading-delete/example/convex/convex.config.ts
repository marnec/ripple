import { defineApp } from "convex/server";
import convexCascadingDelete from "@00akshatsinha00/convex-cascading-delete/convex.config.js";

const app = defineApp();
app.use(convexCascadingDelete);

export default app;
