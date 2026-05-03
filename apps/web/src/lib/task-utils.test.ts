import { describe, it, expect } from "vitest";
import {
  formatTaskId,
  getPriorityLabel,
  toISODateString,
  parseISODate,
  formatEstimate,
} from "./task-utils";

describe("formatTaskId", () => {
  it("formats project key and number", () => {
    expect(formatTaskId("ENG", 42)).toBe("ENG-42");
  });

  it("returns undefined when key is missing", () => {
    expect(formatTaskId(undefined, 42)).toBeUndefined();
  });

  it("returns undefined when number is missing", () => {
    expect(formatTaskId("ENG", undefined)).toBeUndefined();
  });
});

describe("getPriorityLabel", () => {
  it("returns correct labels for known priorities", () => {
    expect(getPriorityLabel("urgent")).toBe("Urgent");
    expect(getPriorityLabel("high")).toBe("High");
    expect(getPriorityLabel("medium")).toBe("Medium");
    expect(getPriorityLabel("low")).toBe("Low");
  });

  it("capitalizes unknown priorities", () => {
    expect(getPriorityLabel("custom")).toBe("Custom");
  });
});

describe("toISODateString / parseISODate roundtrip", () => {
  it("roundtrips correctly", () => {
    const original = new Date(2026, 2, 15); // March 15, 2026
    const iso = toISODateString(original);
    expect(iso).toBe("2026-03-15");
    const parsed = parseISODate(iso);
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(2);
    expect(parsed.getDate()).toBe(15);
  });
});

describe("formatEstimate", () => {
  it("formats hours", () => {
    expect(formatEstimate(4)).toBe("4h");
    expect(formatEstimate(0.5)).toBe("0.5h");
  });
});
