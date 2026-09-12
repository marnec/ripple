import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The **assistant tools** are bound to a **summoner** whose identity arrives
 * as data (ADR 0003). A public query resolves its caller from auth instead —
 * the right person on the writing assistant's HTTP surface and nobody at all
 * on the chat reply's workpool surface. So the factory may read only through
 * `assistantReads.ts`, whose queries take the summoner's id and apply the
 * same rule as their public twins. `apps/convex`'s lint step is `tsc` only,
 * so this guard lives in the test suite, like the trigger write guard.
 */

const FACTORY = join(__dirname, "..", "convex", "lib", "assistantTools.ts");

describe("assistant tools read only through assistantReads", () => {
  const src = readFileSync(FACTORY, "utf8");

  it("never imports the public api", () => {
    const apiImports = [...src.matchAll(/import\s+\{([^}]*)\}\s+from\s+"[^"]*_generated\/api"/g)]
      .flatMap((m) => m[1].split(",").map((n) => n.trim()))
      .filter((n) => n === "api");
    expect(apiImports).toEqual([]);
    expect(src).not.toMatch(/\bapi\./);
  });

  it("every runQuery names an assistantReads function", () => {
    const targets = [...src.matchAll(/runQuery\(\s*([\w.]+)/g)].map((m) => m[1]);
    expect(targets.length).toBeGreaterThan(0);
    const offenders = targets.filter((t) => !t.startsWith("internal.assistantReads."));
    expect(offenders).toEqual([]);
  });

  it("does not touch the database or run mutations", () => {
    expect(src).not.toMatch(/runMutation|runAction|ctx\.db\b/);
  });
});
