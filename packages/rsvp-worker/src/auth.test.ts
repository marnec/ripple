import { describe, it, expect } from "vitest";
import { parseAuthResults, emailDomain, verifyAuth } from "./auth";

describe("parseAuthResults", () => {
  it("parses Cloudflare's standard header", () => {
    const h =
      "mx.cloudflare.net; dkim=pass header.d=gmail.com header.s=20230601; spf=pass smtp.mailfrom=alice@gmail.com; dmarc=pass header.from=gmail.com";
    expect(parseAuthResults(h)).toEqual({ dkim: "pass", dmarc: "pass" });
  });

  it("returns none for null/empty", () => {
    expect(parseAuthResults(null)).toEqual({ dkim: "none", dmarc: "none" });
    expect(parseAuthResults("")).toEqual({ dkim: "none", dmarc: "none" });
  });

  it("flags fail when DKIM fails", () => {
    const h = "mx.cloudflare.net; dkim=fail; dmarc=pass";
    expect(parseAuthResults(h)).toEqual({ dkim: "fail", dmarc: "pass" });
  });

  it("does not confuse spf=pass for dkim=pass", () => {
    const h = "mx.cloudflare.net; spf=pass; dmarc=pass";
    expect(parseAuthResults(h)).toEqual({ dkim: "none", dmarc: "pass" });
  });

  it("treats permerror/temperror as fail", () => {
    expect(parseAuthResults("x; dkim=permerror; dmarc=temperror")).toEqual({
      dkim: "fail",
      dmarc: "fail",
    });
  });
});

describe("emailDomain", () => {
  it("extracts and lowercases the domain", () => {
    expect(emailDomain("Alice@Gmail.COM")).toBe("gmail.com");
  });
  it("returns null for missing/malformed input", () => {
    expect(emailDomain(null)).toBeNull();
    expect(emailDomain("")).toBeNull();
    expect(emailDomain("noatsign")).toBeNull();
    expect(emailDomain("@only-domain")).toBeNull();
    expect(emailDomain("user@")).toBeNull();
  });
});

describe("verifyAuth", () => {
  const passHeader =
    "mx.cloudflare.net; dkim=pass header.d=gmail.com; dmarc=pass header.from=gmail.com";

  it("ok when DKIM+DMARC pass and From matches ATTENDEE", () => {
    const r = verifyAuth(passHeader, "alice@gmail.com", "alice@gmail.com");
    expect(r.ok).toBe(true);
    expect(r.fromDomain).toBe("gmail.com");
  });

  it("fails when no envelope From is present", () => {
    const r = verifyAuth(passHeader, null, "alice@gmail.com");
    expect(r).toEqual({ ok: false, reason: "no_envelope_from", fromDomain: null });
  });

  it("fails when there is no Authentication-Results header", () => {
    const r = verifyAuth(null, "alice@gmail.com", "alice@gmail.com");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("no_auth_results");
  });

  it("fails when DKIM is fail/none", () => {
    const failDkim = "mx.cloudflare.net; dkim=fail; dmarc=pass";
    const r = verifyAuth(failDkim, "alice@gmail.com", "alice@gmail.com");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("dkim_fail");
  });

  it("fails when DMARC fails", () => {
    const failDmarc = "mx.cloudflare.net; dkim=pass; dmarc=fail";
    const r = verifyAuth(failDmarc, "alice@gmail.com", "alice@gmail.com");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("dmarc_fail");
  });

  it("fails when From domain doesn't match ATTENDEE domain (forwarded RSVP)", () => {
    // Mallory's mailbox is fully verified, but she's trying to RSVP for Alice.
    const r = verifyAuth(passHeader, "mallory@gmail.com", "alice@example.com");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("from_mismatch");
  });
});
