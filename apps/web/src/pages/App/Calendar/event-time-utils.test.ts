import { describe, expect, it } from "vitest";

import { addMinutes, parseTypedTime, sameDayDuration } from "./event-time-utils";

describe("parseTypedTime", () => {
  it.each([
    ["10", "10:00"],
    ["10am", "10:00"],
    ["10 AM", "10:00"],
    ["10pm", "22:00"],
    ["10 PM", "22:00"],
    ["10p", "22:00"],
    ["10:30", "10:30"],
    ["10.30", "10:30"],
    ["10:30 pm", "22:30"],
    ["1042", "10:42"],
    ["942", "09:42"],
    ["12:00 am", "00:00"],
    ["12 am", "00:00"],
    ["12 pm", "12:00"],
    ["00:00", "00:00"],
    ["23:59", "23:59"],
    [" 10:30 ", "10:30"],
  ])("parses %s → %s", (input, expected) => {
    expect(parseTypedTime(input)).toBe(expected);
  });

  it.each([
    "",
    "abc",
    "25:00", // hour overflow
    "10:60", // minute overflow
    "13 pm", // meridiem hour overflow
    "0 am", // meridiem requires 1..12
    "99999", // too long
    "10:",
  ])("rejects %s", (input) => {
    expect(parseTypedTime(input)).toBeNull();
  });
});

describe("addMinutes", () => {
  it("adds minutes within the same day", () => {
    expect(addMinutes("09:00", 60)).toBe("10:00");
    expect(addMinutes("09:30", 90)).toBe("11:00");
  });

  it("wraps at midnight", () => {
    expect(addMinutes("23:30", 60)).toBe("00:30");
    expect(addMinutes("00:00", -30)).toBe("23:30");
  });
});

describe("sameDayDuration", () => {
  it("formats positive durations", () => {
    expect(sameDayDuration("09:00", "10:00")).toBe("1 hr");
    expect(sameDayDuration("09:00", "10:15")).toBe("1 hr 15 min");
    expect(sameDayDuration("09:00", "09:30")).toBe("30 min");
  });

  it("returns empty when end ≤ start (cross-midnight cases)", () => {
    expect(sameDayDuration("10:00", "09:00")).toBe("");
    expect(sameDayDuration("10:00", "10:00")).toBe("");
  });
});
