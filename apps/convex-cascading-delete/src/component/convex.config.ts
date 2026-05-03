import { defineComponent } from "convex/server";
import workflow from "@convex-dev/workflow/convex.config";

const component = defineComponent("convexCascadingDelete");
component.use(workflow);
export default component;
