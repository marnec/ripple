import { describe, expect, it } from "vitest";
import { normalizeLinkUrl } from "./link-url";

describe("normalizeLinkUrl", () => {
  it("assumes https for input without a scheme", () => {
    expect(normalizeLinkUrl("example.com")).toBe("https://example.com/");
    expect(normalizeLinkUrl("www.example.com/a?b=1")).toBe("https://www.example.com/a?b=1");
    expect(normalizeLinkUrl("  https://example.com/a  ")).toBe("https://example.com/a");
  });

  it("keeps a port that only looks like a scheme", () => {
    expect(normalizeLinkUrl("example.com:8080/x")).toBe("https://example.com:8080/x");
  });

  it("turns a word that is not a URL into an external address, never a relative one", () => {
    // The bug this exists for: the composer used the selected text as the href,
    // so `asdf` became `<a href="asdf">` and clicking it navigated the SPA to a
    // route that does not exist.
    expect(normalizeLinkUrl("asdf")).toBe("https://asdf/");
  });

  it("rejects anything that would resolve against the current page", () => {
    for (const relative of ["/settings", "./x", "../x", "#top", "?q=1", "//evil.com"]) {
      expect(normalizeLinkUrl(relative)).toBeNull();
    }
  });

  it("rejects script and data payloads however they are spelled", () => {
    for (const hostile of [
      "javascript:alert(1)",
      "JavaScript:void(0)",
      "java\nscript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox",
      "file:///etc/passwd",
    ]) {
      expect(normalizeLinkUrl(hostile)).toBeNull();
    }
  });

  it("rejects a foreign scheme rather than guessing a destination for it", () => {
    expect(normalizeLinkUrl("ftp://files.example.com")).toBeNull();
  });

  it("keeps mailto and tel intact", () => {
    expect(normalizeLinkUrl("mailto:a@b.com")).toBe("mailto:a@b.com");
    expect(normalizeLinkUrl("tel:+3933312")).toBe("tel:+3933312");
  });

  it("rejects empty and unparseable input", () => {
    expect(normalizeLinkUrl("")).toBeNull();
    expect(normalizeLinkUrl("   ")).toBeNull();
    expect(normalizeLinkUrl("https://exa mple.com")).toBeNull();
  });
});
