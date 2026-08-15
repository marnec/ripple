/**
 * Sweep #10 — the host check behind `registerSubscription`.
 *
 * Tested apart from the mutation because host matching is where this class of
 * check goes wrong, and the interesting inputs are all near-misses: the naïve
 * `endpoint.endsWith("fcm.googleapis.com")` an allowlist invites accepts both
 * `evil-fcm.googleapis.com` and `fcm.googleapis.com.attacker.net`, and neither
 * is worth a database round-trip to state.
 */

import { describe, expect, it } from "vitest";
import { isAllowedPushEndpoint } from "../convex/utils/pushEndpoints";

describe("isAllowedPushEndpoint", () => {
  /**
   * One real endpoint shape per vendor. The list is the whole security
   * boundary, so a host dropped from it by accident has to fail here rather
   * than in production, where the symptom is "push quietly stopped working".
   */
  it.each([
    ["Chrome / FCM", "https://fcm.googleapis.com/fcm/send/dK3l:APA91bF"],
    ["Firefox", "https://updates.push.services.mozilla.com/wpush/v2/gAAAA"],
    ["Edge / WNS", "https://wns2-bl2p.notify.windows.com/w/?token=BQYAAAB"],
    ["Safari", "https://web.push.apple.com/QMHnLQAcbCE8"],
  ])("accepts a real %s endpoint", (_vendor, endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(true);
  });

  /**
   * The two shapes a suffix check gets wrong: a host that ends with the
   * allowed string but is a different label (`evil-fcm…`), and a host that
   * merely has the allowed name as a prefix of its own domain
   * (`fcm.googleapis.com.attacker.net`) — the classic allowlist bypass.
   */
  it.each([
    ["a lookalike label", "https://evil-fcm.googleapis.com/push/abc"],
    ["a parent-domain fake", "https://fcm.googleapis.com.attacker.net/push/abc"],
    ["an unrelated host", "https://attacker.example.com/push/abc"],
    ["a sibling Google host", "https://storage.googleapis.com/push/abc"],
  ])("refuses %s", (_shape, endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(false);
  });

  /**
   * The private-network targets an SSRF primitive is actually pointed at. They
   * fall out of the allowlist rather than needing their own rule — which is
   * the argument for an allowlist over a "looks safe" check.
   */
  it.each([
    ["localhost", "https://localhost:3000/push"],
    ["an IPv4 literal", "https://127.0.0.1/push"],
    ["an IPv6 literal", "https://[::1]/push"],
    ["link-local metadata", "https://169.254.169.254/latest/meta-data/"],
    ["an internal name", "https://vault.internal/push"],
  ])("refuses %s", (_shape, endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(false);
  });

  it("refuses a non-https scheme on an otherwise allowed host", () => {
    expect(isAllowedPushEndpoint("http://fcm.googleapis.com/push/abc")).toBe(
      false,
    );
  });

  /**
   * `new URL` reads the host correctly here, but a credentialed URL is never
   * something a push service issued, and parsers disagree about where the host
   * starts — so it does not get to reach one.
   */
  it("refuses credentials embedded in the URL", () => {
    expect(
      isAllowedPushEndpoint("https://user:pass@fcm.googleapis.com/push/abc"),
    ).toBe(false);
  });

  it("refuses input that is not a URL at all", () => {
    expect(isAllowedPushEndpoint("")).toBe(false);
    expect(isAllowedPushEndpoint("fcm.googleapis.com/push/abc")).toBe(false);
    expect(isAllowedPushEndpoint("//fcm.googleapis.com/push/abc")).toBe(false);
  });

  /** The column is not storage: a megabyte of path is not an endpoint. */
  it("refuses an over-long endpoint on an allowed host", () => {
    const long = `https://fcm.googleapis.com/push/${"a".repeat(4096)}`;
    expect(isAllowedPushEndpoint(long)).toBe(false);
  });
});
