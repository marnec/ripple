import { describe, expect, it } from "vitest";
import { effectDisabledReason, hasEffect, STATUS_EFFECTS } from "./statusEffectRules";

const plain = { isDefault: false, isTriage: false, isCompleted: false, setsStartDate: false };

describe("effectDisabledReason", () => {
  it("allows every effect on a status that holds none", () => {
    for (const { effect } of STATUS_EFFECTS) {
      expect(effectDisabledReason(plain, effect)).toBeUndefined();
    }
  });

  it("keeps the inbox out of default and completed", () => {
    const inbox = { ...plain, isTriage: true };
    expect(effectDisabledReason(inbox, "default")).toBeDefined();
    expect(effectDisabledReason(inbox, "completed")).toBeDefined();
    expect(effectDisabledReason(inbox, "startsWork")).toBeUndefined();
  });

  it("keeps default and completed statuses out of the inbox", () => {
    expect(effectDisabledReason({ ...plain, isDefault: true }, "triage")).toBeDefined();
    expect(effectDisabledReason({ ...plain, isCompleted: true }, "triage")).toBeDefined();
  });

  it("makes starts-work and completed mutually exclusive", () => {
    expect(effectDisabledReason({ ...plain, isCompleted: true }, "startsWork")).toBeDefined();
    expect(effectDisabledReason({ ...plain, setsStartDate: true }, "completed")).toBeDefined();
  });
});

describe("hasEffect", () => {
  it("treats unset optional flags as off", () => {
    const legacy = { isDefault: false, isCompleted: false };
    expect(hasEffect(legacy, "triage")).toBe(false);
    expect(hasEffect(legacy, "startsWork")).toBe(false);
  });
});
