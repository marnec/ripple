import { describe, expect, it } from "vitest";
import { attachmentKindFor, hasImageBlocks } from "./messageUtils";

describe("attachmentKindFor", () => {
  it("routes image MIME types to the inline image path", () => {
    expect(attachmentKindFor("image/png")).toBe("image");
    expect(attachmentKindFor("image/svg+xml")).toBe("image");
  });

  it("routes everything else to the file attachment path", () => {
    expect(attachmentKindFor("application/pdf")).toBe("file");
    expect(attachmentKindFor("text/csv")).toBe("file");
    expect(attachmentKindFor("video/mp4")).toBe("file");
  });

  it("treats a file the browser could not type as a file, not an image", () => {
    // A drop off a network share routinely arrives as "" — guessing "image"
    // there would send it down the thumbnail path, which cannot decode it.
    expect(attachmentKindFor("")).toBe("file");
    expect(attachmentKindFor(undefined)).toBe("file");
  });
});

describe("hasImageBlocks", () => {
  it("is true only for a top-level image block", () => {
    expect(hasImageBlocks([{ type: "image" }])).toBe(true);
    expect(hasImageBlocks([{ type: "file" }, { type: "paragraph" }])).toBe(false);
  });
});
