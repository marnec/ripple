import { describe, expect, it } from "vitest";
import { extractMediaTokens, mediaTokenFromUrl } from "../convex/utils/mediaTokens";

describe("extractMediaTokens", () => {
  it("finds storage tokens in any text, deduplicated and lowercased", () => {
    const url = "https://x.convex.cloud/api/storage/D0D1BFCC-27EB-4201-8EFA-B3D27C18F928";
    const text = `{"url":"${url}"} and again ${url.toLowerCase()} and junk /api/storage/not-a-token`;
    expect(extractMediaTokens(text)).toEqual(["d0d1bfcc-27eb-4201-8efa-b3d27c18f928"]);
  });

  it("matches on the path, so a different host still resolves", () => {
    expect(mediaTokenFromUrl("https://custom.example/api/storage/a8b2fc90-1f2c-425d-849d-f99d9fcaafc5")).toBe(
      "a8b2fc90-1f2c-425d-849d-f99d9fcaafc5",
    );
    expect(mediaTokenFromUrl("https://example.com/image.png")).toBeNull();
  });

  it("reads a URL out of binary framing (a Yjs snapshot decoded as UTF-8)", () => {
    const url = "https://x.convex.cloud/api/storage/8569b5ae-8165-46cb-a958-0163ad644c0b";
    const bytes = new Uint8Array([0xff, 0x00, 0x77, ...new TextEncoder().encode(url), 0x00, 0xc3]);
    expect(extractMediaTokens(new TextDecoder().decode(bytes))).toEqual([
      "8569b5ae-8165-46cb-a958-0163ad644c0b",
    ]);
  });
});
