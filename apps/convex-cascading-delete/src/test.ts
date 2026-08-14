/// <reference types="vite/client" />
import type { TestConvex } from "convex-test";
import type { GenericSchema, SchemaDefinition } from "convex/server";
import schema from "./component/schema.js";
import workflow from "@convex-dev/workflow/test";
const modules = import.meta.glob("./component/**/*.ts");

/**
 * Register the component with the test convex instance.
 * @param t - The test convex instance, e.g. from calling `convexTest`.
 * @param name - The name of the component, as registered in convex.config.ts.
 */
export function register(
  t: TestConvex<SchemaDefinition<GenericSchema, boolean>>,
  name: string = "convexCascadingDelete",
) {
  t.registerComponent(name, schema as any, modules);
  // `convex.config.ts` does `component.use(workflow)`, so batched deletion
  // drives a nested workflow (which nests a workpool in turn). Without this the
  // batched path works under test only while every target fits in the first
  // inline batch — the moment a job is actually scheduled, `startProcessing`
  // fails with "is not a functionReference". Same shape as
  // `@convex-dev/workflow`'s own helper registering its nested workpool.
  workflow.register(t as never, `${name}/workflow`);
}
export default { register, schema, modules };
