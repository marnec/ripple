import { describe, expect, it } from "vitest";
import { formatFileSize } from "./constants";

describe("formatFileSize", () => {
  it("keeps bytes and kilobytes whole and gives megabytes up one decimal", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(14 * 1024)).toBe("14 KB");
    expect(formatFileSize(2411724)).toBe("2.3 MB");
    expect(formatFileSize(3 * 1024 * 1024 * 1024)).toBe("3.0 GB");
  });

  it("drops the decimal once the value is big enough not to need it", () => {
    expect(formatFileSize(24 * 1024 * 1024)).toBe("24 MB");
  });

  it("renders a missing or nonsensical size as zero rather than NaN", () => {
    expect(formatFileSize(NaN)).toBe("0 B");
    expect(formatFileSize(-1)).toBe("0 B");
  });
});
