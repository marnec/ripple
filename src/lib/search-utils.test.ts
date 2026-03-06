import { describe, it, expect } from "vitest";
import { parseSearchInput, buildSearchString } from "./search-utils";

describe("parseSearchInput", () => {
  it("extracts tags prefixed with #", () => {
    const result = parseSearchInput("hello #design #urgent world");
    expect(result).toEqual({
      searchText: "hello world",
      tags: ["design", "urgent"],
    });
  });

  it("returns empty tags when no # prefixes", () => {
    const result = parseSearchInput("just plain text");
    expect(result).toEqual({ searchText: "just plain text", tags: [] });
  });

  it("handles empty input", () => {
    const result = parseSearchInput("");
    expect(result).toEqual({ searchText: "", tags: [] });
  });

  it("lowercases tags", () => {
    const result = parseSearchInput("#Design #URGENT");
    expect(result).toEqual({ searchText: "", tags: ["design", "urgent"] });
  });

  it("keeps standalone # as text", () => {
    const result = parseSearchInput("test # value");
    expect(result).toEqual({ searchText: "test # value", tags: [] });
  });
});

describe("buildSearchString", () => {
  it("combines text and tags", () => {
    expect(buildSearchString("hello", ["design", "urgent"])).toBe(
      "hello #design #urgent",
    );
  });

  it("returns only tags when no text", () => {
    expect(buildSearchString("", ["tag"])).toBe("#tag");
  });

  it("returns only text when no tags", () => {
    expect(buildSearchString("hello", [])).toBe("hello");
  });
});
