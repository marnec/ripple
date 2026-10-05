import { describe, expect, it } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import { scopeCreateCycle, scopeCycleArg } from "./taskScope";

const cycleId = "c1" as Id<"cycles">;

describe("scopeCycleArg", () => {
  it("maps each scope to listByProject's cycle argument", () => {
    expect(scopeCycleArg({ kind: "cycle", cycleId })).toBe(cycleId);
    expect(scopeCycleArg({ kind: "backlog" })).toBeNull();
  });
});

describe("scopeCreateCycle", () => {
  it("files new tasks into the viewed cycle, otherwise the backlog", () => {
    expect(scopeCreateCycle({ kind: "cycle", cycleId })).toBe(cycleId);
    expect(scopeCreateCycle({ kind: "backlog" })).toBeUndefined();
  });
});
