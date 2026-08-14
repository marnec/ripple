import { defineConfig, type Plugin } from "vitest/config";
import path from "path";

/**
 * `@convex-dev/workflow`'s determinism sandbox (`client/environment.ts`) does
 * `delete globalThis.process` while a workflow handler runs, and restores it
 * afterwards. In the real Convex runtime that is free — `process` does not
 * exist there and each function gets its own isolate. Under convex-test the
 * workflow shares one JS realm with the test runner, so the deletion takes
 * `process` away from convex-test's own machinery mid-step and every syscall
 * inside the handler dies with "process is not defined".
 *
 * That makes any workflow-backed component untestable here — for us, the
 * batched cascade (`deleteWithCascadeBatched` past its first inline batch),
 * which is how every unbounded parent in this schema deletes. Neutralising the
 * one deletion keeps the rest of the sandbox (seeded Math.random, deterministic
 * Date, journalled console) intact; nothing under test reads `process` for
 * anything a workflow could branch on, so determinism is unaffected.
 */
function keepProcessInWorkflowSandbox(): Plugin {
  const TARGET = "@convex-dev/workflow/dist/client/environment";
  const NEEDLE = "delete global.process;";
  return {
    name: "ripple:keep-process-in-workflow-sandbox",
    enforce: "pre",
    transform(code, id) {
      if (!id.includes(TARGET) || !code.includes(NEEDLE)) return null;
      return {
        code: code.replace(
          NEEDLE,
          "/* ripple: kept — convex-test shares this realm */",
        ),
        map: null,
      };
    },
  };
}

export default defineConfig({
  plugins: [keepProcessInWorkflowSandbox()],
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../../packages/shared/src"),
    },
  },
  test: {
    name: "backend",
    include: ["tests/**/*.test.ts"],
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    server: {
      // The plugin above only runs if this module is transformed rather than
      // loaded straight from node_modules by Node's ESM loader.
      deps: { inline: [/@convex-dev\/workflow/] },
    },
  },
});
