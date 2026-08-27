import { describe, expect, it } from "vitest";
import { generateNumericCode } from "../convex/utils/otp";

/**
 * This replaced `oslo/crypto`'s `generateRandomString`, which is the token a
 * sign-in email carries — so the two properties that matter are shape (the
 * caller mails it as an 8-digit code) and uniformity (a skewed digit
 * distribution shrinks the guess space of every code we ever send).
 *
 * The uniformity assertion is the reason the implementation rejects bytes
 * >= 250 instead of taking `byte % 10`: with folding, digits 0-5 arrive
 * 26/256 of the time and 6-9 arrive 25/256, which this bound catches.
 */
describe("generateNumericCode", () => {
  it("returns exactly `length` digits", () => {
    for (const length of [1, 6, 8, 32]) {
      const code = generateNumericCode(length);
      expect(code).toHaveLength(length);
      expect(code).toMatch(/^\d+$/);
    }
  });

  it("keeps leading zeros rather than dropping them to a shorter number", () => {
    // 20k codes of length 4 — P(no code starts with 0) is ~0 if unbiased.
    const codes = Array.from({ length: 20_000 }, () => generateNumericCode(4));
    expect(codes.some((code) => code.startsWith("0"))).toBe(true);
    expect(codes.every((code) => code.length === 4)).toBe(true);
  });

  it("distributes digits evenly", () => {
    const counts = new Map<string, number>();
    const total = 100_000;
    for (const digit of generateNumericCode(total)) {
      counts.set(digit, (counts.get(digit) ?? 0) + 1);
    }
    expect(counts.size).toBe(10);
    // Expected 10_000 each; +/-5% is far wider than sampling noise at this n,
    // and far narrower than the ~4% skew `% 10` folding would introduce.
    for (const count of counts.values()) {
      expect(count).toBeGreaterThan(9_500);
      expect(count).toBeLessThan(10_500);
    }
  });

  it("does not repeat itself", () => {
    const codes = new Set(Array.from({ length: 1_000 }, () => generateNumericCode(8)));
    expect(codes.size).toBe(1_000);
  });
});
